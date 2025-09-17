import { VercelRequest, VercelResponse } from '@vercel/node';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  useMultiFileAuthState,
  Browsers,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import pino from 'pino';
import * as path from 'path';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Store connections in memory (will reset on each cold start)
const connections = new Map<string, WhatsAppConnection>();

interface WhatsAppConnection {
  socket: any;
  isConnected: boolean;
  qr: string | null;
  userId: string;
  phoneNumber?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, userId, phoneNumber, message } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'Action is required' });
  }

  try {
    switch (action) {
      case 'connect':
        return await handleConnect(userId, res);

      case 'disconnect':
        return await handleDisconnect(userId, res);

      case 'send-message':
        return await handleSendMessage(userId, phoneNumber, message, res);

      case 'get-status':
        return await handleGetStatus(userId, res);

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleConnect(userId: string, res: VercelResponse) {
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Check if already connected
    if (connections.has(userId)) {
      const conn = connections.get(userId);
      if (conn.isConnected) {
        return res.json({
          success: true,
          connected: true,
          message: 'Already connected'
        });
      }
    }

    // Create auth state in temp directory
    const tempDir = path.join('/tmp', 'whatsapp-sessions', userId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome')
    });

    const connection = {
      socket,
      isConnected: false,
      qr: null,
      userId
    };

    connections.set(userId, connection);

    // Handle connection updates
    socket.ev.on('connection.update', async (update) => {
      const { connection: connectionState, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrCode = await QRCode.toDataURL(qr);
          connection.qr = qrCode;

          // Save QR to database for persistence
          await supabase
            .from('whatsapp_sessions')
            .upsert({
              user_id: userId,
              session_data: { qr: qrCode },
              is_connected: false,
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        } catch (error) {
          console.error('Failed to generate QR code', error);
        }
      }

      if (connectionState === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        connection.isConnected = false;

        await supabase
          .from('whatsapp_sessions')
          .update({ is_connected: false })
          .eq('user_id', userId);

        if (!shouldReconnect) {
          connections.delete(userId);
        }
      }

      if (connectionState === 'open') {
        console.log(`WhatsApp connected for user ${userId}`);
        connection.isConnected = true;
        connection.phoneNumber = socket.user?.id.split('@')[0];
        connection.qr = null;

        await supabase
          .from('whatsapp_sessions')
          .update({
            is_connected: true,
            phone_number: connection.phoneNumber,
            session_data: { connected: true }
          })
          .eq('user_id', userId);
      }
    });

    socket.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const from = msg.key.remoteJid!;
        const phoneNumber = from.split('@')[0];
        const messageContent = msg.message.conversation ||
                              msg.message.extendedTextMessage?.text ||
                              'Media message';

        // Save to database
        await supabase
          .from('whatsapp_messages')
          .insert({
            user_id: userId,
            phone_number: phoneNumber,
            message: messageContent,
            direction: 'inbound',
            status: 'received',
            created_at: new Date().toISOString()
          });
      }
    });

    // Return current status
    return res.json({
      success: true,
      connected: connection.isConnected,
      qr: connection.qr,
      message: 'Connection initiated'
    });

  } catch (error) {
    console.error('Connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to connect'
    });
  }
}

async function handleDisconnect(userId: string, res: VercelResponse) {
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const connection = connections.get(userId);

    if (connection) {
      connection.socket.end(undefined);
      connections.delete(userId);
    }

    await supabase
      .from('whatsapp_sessions')
      .update({ is_connected: false })
      .eq('user_id', userId);

    return res.json({ success: true, message: 'Disconnected' });
  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({ error: 'Failed to disconnect' });
  }
}

async function handleSendMessage(
  userId: string,
  phoneNumber: string,
  message: string,
  res: VercelResponse
) {
  if (!userId || !phoneNumber || !message) {
    return res.status(400).json({
      error: 'Missing required fields: userId, phoneNumber, message'
    });
  }

  try {
    const connection = connections.get(userId);

    if (!connection || !connection.isConnected) {
      return res.status(400).json({
        success: false,
        error: 'Not connected to WhatsApp'
      });
    }

    const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    const sentMsg = await connection.socket.sendMessage(jid, { text: message });

    // Save to database
    await supabase
      .from('whatsapp_messages')
      .insert({
        user_id: userId,
        phone_number: phoneNumber,
        message: message,
        direction: 'outbound',
        status: 'sent',
        created_at: new Date().toISOString()
      });

    return res.json({
      success: true,
      messageId: sentMsg?.key.id,
      message: 'Message sent'
    });
  } catch (error) {
    console.error('Send message error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
}

async function handleGetStatus(userId: string, res: VercelResponse) {
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Check in-memory connection
    const connection = connections.get(userId);

    if (connection) {
      return res.json({
        success: true,
        connected: connection.isConnected,
        phoneNumber: connection.phoneNumber,
        qr: connection.qr
      });
    }

    // Check database for persistent session
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (session) {
      return res.json({
        success: true,
        connected: session.is_connected,
        phoneNumber: session.phone_number,
        qr: session.session_data?.qr || null
      });
    }

    return res.json({
      success: true,
      connected: false,
      message: 'No session found'
    });
  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ error: 'Failed to get status' });
  }
}
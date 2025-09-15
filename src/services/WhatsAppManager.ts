import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  WASocket,
  ConnectionState,
  proto,
  WAMessage,
  AnyMessageContent,
  delay,
  useMultiFileAuthState,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Server } from 'socket.io';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';
import { logger } from '../utils/logger';
import { SupabaseService } from './SupabaseService';
import pino from 'pino';

interface WhatsAppConnection {
  socket: WASocket;
  store: ReturnType<typeof makeInMemoryStore>;
  qr?: string;
  isConnected: boolean;
  userId: string;
  phoneNumber?: string;
}

export class WhatsAppManager {
  private connections: Map<string, WhatsAppConnection> = new Map();
  private supabase: SupabaseService;
  private io: Server;
  private sessionsPath: string;

  constructor(supabase: SupabaseService, io: Server) {
    this.supabase = supabase;
    this.io = io;
    this.sessionsPath = process.env.SESSION_PATH || './sessions';

    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    logger.info('Initializing WhatsApp Manager...');
    await this.supabase.createSessionsTable();
    await this.restoreActiveSessions();
  }

  private async restoreActiveSessions(): Promise<void> {
    try {
      const sessionDirs = fs.readdirSync(this.sessionsPath);

      for (const userId of sessionDirs) {
        const sessionPath = path.join(this.sessionsPath, userId);
        if (fs.statSync(sessionPath).isDirectory()) {
          const session = await this.supabase.getSession(userId);
          if (session && session.is_connected) {
            logger.info(`Restoring session for user ${userId}`);
            await this.connectUser(userId);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to restore sessions', error);
    }
  }

  async connectUser(userId: string): Promise<{ success: boolean; qr?: string; message?: string }> {
    try {
      if (this.connections.has(userId)) {
        const conn = this.connections.get(userId)!;
        if (conn.isConnected) {
          return { success: true, message: 'Already connected' };
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(this.sessionsPath, userId)
      );

      const { version } = await fetchLatestBaileysVersion();
      const store = makeInMemoryStore({
        logger: pino().child({ level: 'silent', stream: 'store' })
      });

      const socket = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        msgRetryCounterCache: {},
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
      });

      store.bind(socket.ev);

      const connection: WhatsAppConnection = {
        socket,
        store,
        isConnected: false,
        userId
      };

      this.connections.set(userId, connection);
      this.setupEventHandlers(userId, socket, saveCreds);

      return { success: true, message: 'Connection initiated' };
    } catch (error) {
      logger.error(`Failed to connect user ${userId}`, error);
      return { success: false, message: 'Failed to connect' };
    }
  }

  private setupEventHandlers(userId: string, socket: WASocket, saveCreds: () => Promise<void>): void {
    socket.ev.on('connection.update', async (update: ConnectionState) => {
      const { connection, lastDisconnect, qr } = update;
      const conn = this.connections.get(userId);

      if (qr) {
        try {
          const qrCode = await QRCode.toDataURL(qr);
          if (conn) {
            conn.qr = qrCode;
          }

          this.io.to(`user:${userId}`).emit('qr', { qr: qrCode });
          logger.info(`QR code generated for user ${userId}`);
        } catch (error) {
          logger.error('Failed to generate QR code', error);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (conn) {
          conn.isConnected = false;
        }

        await this.supabase.updateSessionStatus(userId, false);
        this.io.to(`user:${userId}`).emit('connection-status', { connected: false });

        if (shouldReconnect) {
          logger.info(`Reconnecting user ${userId}...`);
          setTimeout(() => this.connectUser(userId), 5000);
        } else {
          logger.info(`User ${userId} logged out`);
          this.connections.delete(userId);
          this.clearUserSession(userId);
        }
      }

      if (connection === 'open') {
        logger.info(`WhatsApp connected for user ${userId}`);

        if (conn) {
          conn.isConnected = true;
          conn.phoneNumber = socket.user?.id.split('@')[0];
          conn.qr = undefined;
        }

        const phoneNumber = socket.user?.id.split('@')[0];
        await this.supabase.updateSessionStatus(userId, true, phoneNumber);

        this.io.to(`user:${userId}`).emit('connection-status', {
          connected: true,
          phoneNumber
        });
      }
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        await this.handleIncomingMessage(userId, msg);
      }
    });

    socket.ev.on('messages.update', async (messages) => {
      for (const msg of messages) {
        if (msg.update?.status) {
          await this.supabase.updateMessageStatus(msg.key.id!, msg.update.status.toString());
        }
      }
    });
  }

  private async handleIncomingMessage(userId: string, message: WAMessage): Promise<void> {
    try {
      if (!message.message || message.key.fromMe) return;

      const messageContent = this.extractMessageContent(message);
      if (!messageContent) return;

      const from = message.key.remoteJid!;
      const phoneNumber = from.split('@')[0];
      const pushName = message.pushName || phoneNumber;

      const profile = await this.supabase.getUserProfile(userId);
      if (!profile) return;

      const patient = await this.supabase.findOrCreatePatient(
        phoneNumber,
        profile.id,
        pushName
      );

      await this.supabase.saveMessage({
        clinic_id: profile.id,
        patient_id: patient?.id,
        phone: phoneNumber,
        message_type: 'inbound',
        content: messageContent,
        message_status: 'delivered',
        whatsapp_message_id: message.key.id
      });

      this.io.to(`user:${userId}`).emit('new-message', {
        from: phoneNumber,
        content: messageContent,
        pushName,
        timestamp: message.messageTimestamp
      });

      logger.info(`Message received from ${phoneNumber} for user ${userId}`);
    } catch (error) {
      logger.error('Failed to handle incoming message', error);
    }
  }

  private extractMessageContent(message: WAMessage): string | null {
    const msg = message.message;
    if (!msg) return null;

    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.imageMessage?.caption) return msg.imageMessage.caption;
    if (msg.videoMessage?.caption) return msg.videoMessage.caption;
    if (msg.documentMessage?.caption) return msg.documentMessage.caption;

    return null;
  }

  async sendMessage(
    userId: string,
    to: string,
    content: AnyMessageContent
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const connection = this.connections.get(userId);

      if (!connection || !connection.isConnected) {
        return { success: false, error: 'Not connected to WhatsApp' };
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      const sentMsg = await connection.socket.sendMessage(jid, content);

      const profile = await this.supabase.getUserProfile(userId);
      if (profile) {
        const messageText = typeof content === 'string' ? content :
                          (content as any).text ||
                          (content as any).caption ||
                          'Media message';

        await this.supabase.saveMessage({
          clinic_id: profile.id,
          phone: to,
          message_type: 'outbound',
          content: messageText,
          message_status: 'sent',
          whatsapp_message_id: sentMsg?.key.id
        });
      }

      logger.info(`Message sent to ${to} by user ${userId}`);
      return { success: true, messageId: sentMsg?.key.id };
    } catch (error) {
      logger.error(`Failed to send message`, error);
      return { success: false, error: 'Failed to send message' };
    }
  }

  async disconnectUser(userId: string): Promise<{ success: boolean }> {
    try {
      const connection = this.connections.get(userId);

      if (connection) {
        connection.socket.end(undefined);
        this.connections.delete(userId);
      }

      await this.supabase.updateSessionStatus(userId, false);
      this.clearUserSession(userId);

      logger.info(`User ${userId} disconnected`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to disconnect user ${userId}`, error);
      return { success: false };
    }
  }

  private clearUserSession(userId: string): void {
    const sessionPath = path.join(this.sessionsPath, userId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  }

  getConnectionStatus(userId: string): { connected: boolean; phoneNumber?: string; qr?: string } {
    const connection = this.connections.get(userId);

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: connection.isConnected,
      phoneNumber: connection.phoneNumber,
      qr: connection.qr
    };
  }

  getAllConnections(): Map<string, WhatsAppConnection> {
    return this.connections;
  }
}
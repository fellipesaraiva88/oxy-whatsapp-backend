import { Express, Request, Response } from 'express';
import { WhatsAppManager } from '../services/WhatsAppManager';
import { SupabaseService } from '../services/SupabaseService';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  userId?: string;
}

export function setupRoutes(
  app: Express,
  whatsappManager: WhatsAppManager,
  supabaseService: SupabaseService
): void {

  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.post('/api/connect', async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      logger.info(`Connection request from user ${userId}`);
      const result = await whatsappManager.connectUser(userId);

      res.json(result);
    } catch (error) {
      logger.error('Connection error:', error);
      res.status(500).json({ error: 'Failed to connect' });
    }
  });

  app.post('/api/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      const result = await whatsappManager.disconnectUser(userId);
      res.json(result);
    } catch (error) {
      logger.error('Disconnection error:', error);
      res.status(500).json({ error: 'Failed to disconnect' });
    }
  });

  app.get('/api/status/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const status = whatsappManager.getConnectionStatus(userId);

      res.json(status);
    } catch (error) {
      logger.error('Status check error:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  app.post('/api/send-message', async (req: AuthRequest, res: Response) => {
    try {
      const { userId, to, message, type = 'text' } = req.body;

      if (!userId || !to || !message) {
        return res.status(400).json({
          error: 'Missing required fields: userId, to, message'
        });
      }

      let content: any;

      switch (type) {
        case 'text':
          content = { text: message };
          break;
        case 'image':
          content = {
            image: { url: message.url },
            caption: message.caption
          };
          break;
        case 'document':
          content = {
            document: { url: message.url },
            fileName: message.fileName,
            caption: message.caption
          };
          break;
        default:
          content = { text: message };
      }

      const result = await whatsappManager.sendMessage(userId, to, content);
      res.json(result);
    } catch (error) {
      logger.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.post('/api/send-bulk', async (req: AuthRequest, res: Response) => {
    try {
      const { userId, recipients, message, delay: delayMs = 1000 } = req.body;

      if (!userId || !recipients || !Array.isArray(recipients) || !message) {
        return res.status(400).json({
          error: 'Missing required fields: userId, recipients (array), message'
        });
      }

      const results = [];

      for (const recipient of recipients) {
        const result = await whatsappManager.sendMessage(
          userId,
          recipient,
          { text: message }
        );

        results.push({
          recipient,
          ...result
        });

        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      res.json({
        success: true,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });
    } catch (error) {
      logger.error('Bulk send error:', error);
      res.status(500).json({ error: 'Failed to send bulk messages' });
    }
  });

  app.get('/api/connections', (req: Request, res: Response) => {
    try {
      const connections = whatsappManager.getAllConnections();
      const connectionList = Array.from(connections.entries()).map(([userId, conn]) => ({
        userId,
        connected: conn.isConnected,
        phoneNumber: conn.phoneNumber
      }));

      res.json({
        total: connectionList.length,
        connections: connectionList
      });
    } catch (error) {
      logger.error('Get connections error:', error);
      res.status(500).json({ error: 'Failed to get connections' });
    }
  });

  app.post('/api/check-number', async (req: AuthRequest, res: Response) => {
    try {
      const { userId, phoneNumber } = req.body;

      if (!userId || !phoneNumber) {
        return res.status(400).json({
          error: 'Missing required fields: userId, phoneNumber'
        });
      }

      const connections = whatsappManager.getAllConnections();
      const connection = connections.get(userId);

      if (!connection || !connection.isConnected) {
        return res.status(400).json({ error: 'Not connected to WhatsApp' });
      }

      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      const [result] = await connection.socket.onWhatsApp(jid);

      res.json({
        exists: result?.exists || false,
        jid: result?.jid,
        phoneNumber
      });
    } catch (error) {
      logger.error('Check number error:', error);
      res.status(500).json({ error: 'Failed to check number' });
    }
  });

  logger.info('Routes configured successfully');
}
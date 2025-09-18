import { Express, Request, Response } from 'express';
import { WhatsAppManager } from '../services/WhatsAppManager';
import { logger } from '../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../auth/authMiddleware';

export function setupRoutes(
  app: Express,
  whatsappManager: WhatsAppManager
): void {

  // Public endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Authentication endpoints
  app.post('/api/auth/refresh', authMiddleware.refreshToken);
  app.post('/api/auth/logout', authMiddleware.optionalAuth, authMiddleware.logout);

  // WhatsApp connection endpoints (simplified for compatibility)
  app.post('/api/connect',
    async (req: Request, res: Response): Promise<Response> => {
      try {
        const { userId } = req.body;

        if (!userId) {
          return res.status(400).json({ error: 'User ID required' });
        }

        logger.info(`Connection request from user ${userId}`);
        const result = await whatsappManager.connectUser(userId);

        return res.json(result);
      } catch (error) {
        logger.error('Connection error:', error);
        return res.status(500).json({ error: 'Failed to connect' });
      }
    });

  app.post('/api/disconnect',
    async (req: Request, res: Response): Promise<Response> => {
      try {
        const { userId } = req.body;

        if (!userId) {
          return res.status(400).json({ error: 'User ID required' });
        }

        const result = await whatsappManager.disconnectUser(userId);
        return res.json(result);
      } catch (error) {
        logger.error('Disconnection error:', error);
        return res.status(500).json({ error: 'Failed to disconnect' });
      }
    });

  app.get('/api/status/:userId',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { userId } = req.params;

        if (!userId) {
          res.status(400).json({ error: 'User ID required' });
          return;
        }

        const status = whatsappManager.getConnectionStatus(userId);
        res.json(status);
      } catch (error) {
        logger.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

  app.get('/api/status',
    authMiddleware.authenticate,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const userId = req.userId;

        if (!userId) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const status = whatsappManager.getConnectionStatus(userId);
        res.json(status);
      } catch (error) {
        logger.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

  app.post('/api/send-message',
    async (req: Request, res: Response): Promise<Response> => {
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
      return res.json(result);
    } catch (error) {
      logger.error('Send message error:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.post('/api/send-bulk',
    authMiddleware.authenticate,
    async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
      try {
        const userId = req.userId;
        const { recipients, message, delay: delayMs = 1000 } = req.body;

        if (!userId || !recipients || !Array.isArray(recipients) || !message) {
          return res.status(400).json({
            error: 'Missing required fields: recipients (array), message'
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

      return res.json({
        success: true,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });
    } catch (error) {
      logger.error('Bulk send error:', error);
      return res.status(500).json({ error: 'Failed to send bulk messages' });
    }
  });

  app.get('/api/connections',
    authMiddleware.requireAdmin,  // Admin only endpoint
    (_req: AuthenticatedRequest, res: Response): void => {
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

  app.post('/api/check-number',
    authMiddleware.authenticate,
    async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
      try {
        const userId = req.userId;
        const { phoneNumber } = req.body;

        if (!userId || !phoneNumber) {
          return res.status(400).json({
            error: 'Missing required fields: phoneNumber'
          });
        }

      const connections = whatsappManager.getAllConnections();
      const connection = connections.get(userId);

      if (!connection || !connection.isConnected) {
        return res.status(400).json({ error: 'Not connected to WhatsApp' });
      }

      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      const results = await connection.socket.onWhatsApp(jid);
      const result = results && results.length > 0 ? results[0] : undefined;

      return res.json({
        exists: result?.exists || false,
        jid: result?.jid,
        phoneNumber
      });
    } catch (error) {
      logger.error('Check number error:', error);
      return res.status(500).json({ error: 'Failed to check number' });
    }
  });

  logger.info('Routes configured successfully');
}
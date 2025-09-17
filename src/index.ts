import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { setupRoutes } from './routes';
import { WhatsAppManager } from './services/WhatsAppManager';
import { SupabaseService } from './services/SupabaseService';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
  credentials: true
}));
app.use(express.json());

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    logger.info('Initializing services...');

    const supabaseService = new SupabaseService();
    const whatsappManager = new WhatsAppManager(supabaseService, io);

    await whatsappManager.initialize();

    setupRoutes(app, whatsappManager);

    io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on('join', (userId: string) => {
        socket.join(`user:${userId}`);
        logger.info(`Socket ${socket.id} joined room user:${userId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });

    httpServer.listen(PORT, () => {
      logger.info(`WhatsApp backend server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
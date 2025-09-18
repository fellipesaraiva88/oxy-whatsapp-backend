import dotenv from 'dotenv';
// Load environment variables first
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { logger } from './utils/logger';
import { setupRoutes } from './routes';
import { WhatsAppManager } from './services/WhatsAppManager';
import { SupabaseService } from './services/SupabaseService';
import { authMiddleware } from './auth/authMiddleware';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
    credentials: true
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for API
}));

// CORS with authentication support
app.use(authMiddleware.corsWithCredentials);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

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
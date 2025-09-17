/**
 * Sistema de Health Check para Railway
 * WhatsApp Backend - Oxy Care Connect
 */

import { Express, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import winston from 'winston';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: HealthCheckResult;
    whatsapp: HealthCheckResult;
    memory: HealthCheckResult;
    disk: HealthCheckResult;
  };
  metrics: {
    cpu: number;
    memory: number;
    connections: number;
    messagesPerMinute: number;
  };
}

interface HealthCheckResult {
  status: 'pass' | 'fail' | 'warn';
  duration: number;
  message?: string;
  details?: any;
}

class HealthMonitor {
  private supabase: any;
  private startTime: number;
  private logger: winston.Logger;
  private messageCount: number = 0;
  private lastMessageReset: number = Date.now();

  constructor() {
    this.startTime = Date.now();
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'health.log' })
      ]
    });
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('count(*)')
        .single();

      if (error) throw error;

      const duration = Date.now() - start;

      return {
        status: duration < 1000 ? 'pass' : 'warn',
        duration,
        message: duration < 1000 ? 'Database responsive' : 'Database slow',
        details: { responseTime: duration, recordCount: data.count }
      };
    } catch (error) {
      return {
        status: 'fail',
        duration: Date.now() - start,
        message: `Database connection failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  private async checkWhatsApp(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      // Verificar sessões ativas do WhatsApp
      const { data: sessions, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('id, status, last_seen')
        .eq('status', 'connected');

      if (error) throw error;

      const activeSessions = sessions?.length || 0;
      const recentSessions = sessions?.filter(s =>
        new Date(s.last_seen).getTime() > Date.now() - 5 * 60 * 1000
      ).length || 0;

      const duration = Date.now() - start;

      return {
        status: activeSessions > 0 ? 'pass' : 'warn',
        duration,
        message: `${activeSessions} active sessions, ${recentSessions} recent`,
        details: {
          totalSessions: activeSessions,
          recentSessions,
          threshold: 5
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        duration: Date.now() - start,
        message: `WhatsApp check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  private checkMemory(): HealthCheckResult {
    const start = Date.now();
    const used = process.memoryUsage();
    const total = used.heapTotal;
    const usage = (used.heapUsed / total) * 100;

    return {
      status: usage < 80 ? 'pass' : usage < 90 ? 'warn' : 'fail',
      duration: Date.now() - start,
      message: `Memory usage: ${usage.toFixed(1)}%`,
      details: {
        heapUsed: Math.round(used.heapUsed / 1024 / 1024),
        heapTotal: Math.round(total / 1024 / 1024),
        external: Math.round(used.external / 1024 / 1024),
        rss: Math.round(used.rss / 1024 / 1024),
        usagePercent: usage
      }
    };
  }

  private checkDisk(): HealthCheckResult {
    const start = Date.now();

    try {
      const fs = require('fs');
      const stats = fs.statSync('./');

      return {
        status: 'pass',
        duration: Date.now() - start,
        message: 'Disk accessible',
        details: {
          accessible: true,
          path: process.cwd()
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        duration: Date.now() - start,
        message: `Disk check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  private getMetrics() {
    const now = Date.now();

    // Reset contador de mensagens a cada minuto
    if (now - this.lastMessageReset > 60000) {
      this.messageCount = 0;
      this.lastMessageReset = now;
    }

    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      cpu: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      connections: global.activeConnections || 0,
      messagesPerMinute: this.messageCount
    };
  }

  public incrementMessageCount(): void {
    this.messageCount++;
  }

  public async getHealthStatus(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkWhatsApp(),
      Promise.resolve(this.checkMemory()),
      Promise.resolve(this.checkDisk())
    ]);

    const [database, whatsapp, memory, disk] = checks;

    // Determinar status geral
    const hasFailures = checks.some(check => check.status === 'fail');
    const hasWarnings = checks.some(check => check.status === 'warn');

    const overallStatus = hasFailures ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy';

    const status: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        database,
        whatsapp,
        memory,
        disk
      },
      metrics: this.getMetrics()
    };

    // Log do status se não estiver saudável
    if (overallStatus !== 'healthy') {
      this.logger.warn('Health check warning/failure', { status });
    }

    return status;
  }

  public setupHealthEndpoints(app: Express): void {
    // Health check básico para Railway
    app.get('/health', async (req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        const statusCode = health.status === 'healthy' ? 200 :
                          health.status === 'degraded' ? 200 : 503;

        res.status(statusCode).json(health);
      } catch (error) {
        this.logger.error('Health check error', error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    });

    // Health check detalhado
    app.get('/health/detailed', async (req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        res.json(health);
      } catch (error) {
        this.logger.error('Detailed health check error', error);
        res.status(500).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    });

    // Readiness probe
    app.get('/ready', async (req: Request, res: Response) => {
      try {
        const dbCheck = await this.checkDatabase();
        const isReady = dbCheck.status !== 'fail';

        res.status(isReady ? 200 : 503).json({
          ready: isReady,
          timestamp: new Date().toISOString(),
          database: dbCheck.status
        });
      } catch (error) {
        res.status(503).json({
          ready: false,
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    });

    // Liveness probe
    app.get('/live', (req: Request, res: Response) => {
      res.json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000)
      });
    });

    // Métricas para Prometheus/Grafana
    app.get('/metrics', async (req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        const metrics = [
          `# HELP whatsapp_uptime_seconds Total uptime in seconds`,
          `# TYPE whatsapp_uptime_seconds counter`,
          `whatsapp_uptime_seconds ${health.uptime}`,
          '',
          `# HELP whatsapp_memory_usage_percent Memory usage percentage`,
          `# TYPE whatsapp_memory_usage_percent gauge`,
          `whatsapp_memory_usage_percent ${health.metrics.memory}`,
          '',
          `# HELP whatsapp_messages_per_minute Messages processed per minute`,
          `# TYPE whatsapp_messages_per_minute gauge`,
          `whatsapp_messages_per_minute ${health.metrics.messagesPerMinute}`,
          '',
          `# HELP whatsapp_health_status Health status (1=healthy, 0.5=degraded, 0=unhealthy)`,
          `# TYPE whatsapp_health_status gauge`,
          `whatsapp_health_status ${health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0}`,
          ''
        ].join('\n');

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metrics);
      } catch (error) {
        res.status(500).send('# Error generating metrics\n');
      }
    });
  }

  // Configurar monitoramento automático de alertas
  public startAlertMonitoring(): void {
    setInterval(async () => {
      try {
        const health = await this.getHealthStatus();

        // Alertas críticos
        if (health.status === 'unhealthy') {
          await this.sendCriticalAlert('Sistema não saudável', health);
        }

        // Alertas de warning
        if (health.metrics.memory > 90) {
          await this.sendWarningAlert('Uso de memória alto', { memory: health.metrics.memory });
        }

        if (health.checks.database.status === 'fail') {
          await this.sendCriticalAlert('Falha na conexão com banco de dados', health.checks.database);
        }

      } catch (error) {
        this.logger.error('Alert monitoring error', error);
      }
    }, 60000); // Check every minute
  }

  private async sendCriticalAlert(message: string, details: any): Promise<void> {
    this.logger.error('CRITICAL ALERT', { message, details });

    // Webhook para sistemas externos (Slack, Discord, etc.)
    if (process.env.ALERT_WEBHOOK_URL) {
      try {
        const fetch = (await import('node-fetch')).default;
        await fetch(process.env.ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 CRITICAL: Railway WhatsApp Backend`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Alert:* ${message}\n*Time:* ${new Date().toISOString()}\n*Service:* WhatsApp Backend (Railway)`
                }
              }
            ]
          })
        });
      } catch (error) {
        this.logger.error('Failed to send webhook alert', error);
      }
    }
  }

  private async sendWarningAlert(message: string, details: any): Promise<void> {
    this.logger.warn('WARNING ALERT', { message, details });
  }
}

export default HealthMonitor;
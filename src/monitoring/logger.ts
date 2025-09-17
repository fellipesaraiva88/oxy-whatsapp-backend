import winston from 'winston';
import { format } from 'winston';

// Configuração de logging estruturado
const customFormat = format.combine(
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  format.errors({ stack: true }),
  format.json(),
  format.printf(({ timestamp, level, message, service, userId, sessionId, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      service: service || 'whatsapp-backend',
      userId,
      sessionId,
      ...meta
    });
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'whatsapp-backend' },
  transports: [
    // Console para desenvolvimento
    new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    // Arquivo para produção
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ],
});

// Classe para contexto de logging
export class LogContext {
  private context: Record<string, any> = {};

  setContext(key: string, value: any) {
    this.context[key] = value;
  }

  setUserId(userId: string) {
    this.context.userId = userId;
  }

  setSessionId(sessionId: string) {
    this.context.sessionId = sessionId;
  }

  info(message: string, meta?: any) {
    logger.info(message, { ...this.context, ...meta });
  }

  error(message: string, error?: Error, meta?: any) {
    logger.error(message, {
      ...this.context,
      error: error?.message,
      stack: error?.stack,
      ...meta
    });
  }

  warn(message: string, meta?: any) {
    logger.warn(message, { ...this.context, ...meta });
  }

  debug(message: string, meta?: any) {
    logger.debug(message, { ...this.context, ...meta });
  }
}

// Métricas de aplicação
export class Metrics {
  private static instance: Metrics;
  private metrics: Map<string, any> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  static getInstance(): Metrics {
    if (!this.instance) {
      this.instance = new Metrics();
    }
    return this.instance;
  }

  // Contador (incrementa)
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>) {
    const key = this.buildKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);

    logger.debug('Counter incremented', {
      metric: name,
      value,
      total: current + value,
      labels
    });
  }

  // Gauge (valor atual)
  setGauge(name: string, value: number, labels?: Record<string, string>) {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);

    logger.debug('Gauge updated', {
      metric: name,
      value,
      labels
    });
  }

  // Histograma (distribuição de valores)
  recordHistogram(name: string, value: number, labels?: Record<string, string>) {
    const key = this.buildKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);

    // Manter apenas os últimos 1000 valores
    if (values.length > 1000) {
      values.splice(0, values.length - 1000);
    }

    this.histograms.set(key, values);

    logger.debug('Histogram recorded', {
      metric: name,
      value,
      labels
    });
  }

  // Obter todas as métricas
  getAllMetrics() {
    const result: any = {
      counters: {},
      gauges: {},
      histograms: {}
    };

    // Contadores
    this.counters.forEach((value, key) => {
      result.counters[key] = value;
    });

    // Gauges
    this.gauges.forEach((value, key) => {
      result.gauges[key] = value;
    });

    // Histogramas com estatísticas
    this.histograms.forEach((values, key) => {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        result.histograms[key] = {
          count: values.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    });

    return result;
  }

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  // Métricas específicas do WhatsApp
  recordMessageSent(sessionId: string) {
    this.incrementCounter('whatsapp_messages_sent_total', 1, { sessionId });
  }

  recordMessageReceived(sessionId: string) {
    this.incrementCounter('whatsapp_messages_received_total', 1, { sessionId });
  }

  recordSessionConnected(sessionId: string) {
    this.incrementCounter('whatsapp_sessions_connected_total', 1, { sessionId });
    this.setGauge('whatsapp_session_status', 1, { sessionId, status: 'connected' });
  }

  recordSessionDisconnected(sessionId: string) {
    this.incrementCounter('whatsapp_sessions_disconnected_total', 1, { sessionId });
    this.setGauge('whatsapp_session_status', 0, { sessionId, status: 'disconnected' });
  }

  recordError(type: string, sessionId?: string) {
    this.incrementCounter('whatsapp_errors_total', 1, { type, sessionId });
  }

  recordLatency(operation: string, duration: number, sessionId?: string) {
    this.recordHistogram('whatsapp_operation_duration_ms', duration, { operation, sessionId });
  }
}

export const metrics = Metrics.getInstance();
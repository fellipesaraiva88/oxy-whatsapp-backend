import { Request, Response, NextFunction } from 'express';
import { LogContext, metrics } from './logger';

// Middleware para logging de requisições
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const logContext = new LogContext();

  // Adicionar contexto à requisição
  (req as any).logContext = logContext;

  // Log da requisição
  logContext.info('HTTP Request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.headers['x-user-id'] || null
  });

  // Interceptar a resposta
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;

    // Registrar métricas
    metrics.incrementCounter('http_requests_total', 1, {
      method: req.method,
      route: req.route?.path || req.url,
      status: res.statusCode.toString()
    });

    metrics.recordHistogram('http_request_duration_ms', duration, {
      method: req.method,
      route: req.route?.path || req.url
    });

    // Log da resposta
    logContext.info('HTTP Response', {
      statusCode: res.statusCode,
      duration: duration,
      contentLength: body?.length || 0
    });

    return originalSend.call(this, body);
  };

  next();
}

// Middleware para tratamento de erros
export function errorHandlingMiddleware(error: Error, req: Request, res: Response, next: NextFunction) {
  const logContext = (req as any).logContext || new LogContext();

  // Registrar erro
  metrics.incrementCounter('http_errors_total', 1, {
    method: req.method,
    route: req.route?.path || req.url,
    error: error.constructor.name
  });

  logContext.error('HTTP Error', error, {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode
  });

  if (res.headersSent) {
    return next(error);
  }

  const status = (error as any).status || 500;
  res.status(status).json({
    error: {
      message: error.message,
      status,
      timestamp: new Date().toISOString()
    }
  });
}

// Middleware para métricas de sistema
export function systemMetricsMiddleware() {
  const updateSystemMetrics = () => {
    // Métricas de processo
    const memUsage = process.memoryUsage();
    metrics.setGauge('process_memory_rss_bytes', memUsage.rss);
    metrics.setGauge('process_memory_heap_used_bytes', memUsage.heapUsed);
    metrics.setGauge('process_memory_heap_total_bytes', memUsage.heapTotal);
    metrics.setGauge('process_memory_external_bytes', memUsage.external);

    // CPU usage (aproximado)
    const cpuUsage = process.cpuUsage();
    metrics.setGauge('process_cpu_user_microseconds', cpuUsage.user);
    metrics.setGauge('process_cpu_system_microseconds', cpuUsage.system);

    // Uptime
    metrics.setGauge('process_uptime_seconds', process.uptime());
  };

  // Atualizar a cada 10 segundos
  setInterval(updateSystemMetrics, 10000);
  updateSystemMetrics(); // Primeira execução

  return (req: Request, res: Response, next: NextFunction) => next();
}

// Middleware para rate limiting com métricas
export function rateLimitMetrics(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip;
  const endpoint = req.route?.path || req.url;

  metrics.incrementCounter('rate_limit_requests_total', 1, {
    ip,
    endpoint
  });

  next();
}
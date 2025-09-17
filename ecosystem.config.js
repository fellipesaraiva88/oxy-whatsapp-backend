module.exports = {
  apps: [{
    name: 'whatsapp-backend',
    script: './dist/index.js',
    instances: 1, // Railway doesn't support clustering well
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1800M', // Increased from 1G
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      NODE_OPTIONS: '--max-old-space-size=2048 --enable-source-maps',
      UV_THREADPOOL_SIZE: 16
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Performance optimizations
    node_args: [
      '--max-old-space-size=2048',
      '--enable-source-maps'
    ],
    // Graceful shutdown
    kill_timeout: 5000,
    // Auto restart limits
    max_restarts: 10,
    min_uptime: '10s',
    // Performance monitoring
    monitoring: false,
    pmx: false
  }]
};
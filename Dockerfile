FROM node:20-alpine

WORKDIR /app

# Install native dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install && npm cache clean --force

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source code
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# Create necessary directories
RUN mkdir -p /app/sessions /app/logs && \
    chown -R node:node /app

USER node

# Set production environment
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048 --enable-source-maps"
ENV UV_THREADPOOL_SIZE=16

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "start"]
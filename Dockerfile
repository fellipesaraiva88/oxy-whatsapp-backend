FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

RUN npm install -g typescript && \
    npm run build && \
    npm uninstall -g typescript

RUN mkdir -p /app/sessions /app/logs && \
    chown -R node:node /app

USER node

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "dist/index.js"]
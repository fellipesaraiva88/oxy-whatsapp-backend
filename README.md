# WhatsApp Backend - Oxy Care Connect

Backend Node.js com Baileys para integração persistente do WhatsApp com o sistema Oxy Care Connect.

## Recursos

- ✅ Conexão persistente com WhatsApp via Baileys
- ✅ Gerenciamento de múltiplas sessões
- ✅ Integração com Supabase
- ✅ WebSocket para eventos em tempo real
- ✅ API REST para controle
- ✅ Docker ready para deployment

## Instalação

### Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Copiar arquivo de configuração
cp .env.example .env

# Editar .env com suas credenciais do Supabase

# Executar em desenvolvimento
npm run dev
```

### Produção com Docker

```bash
# Build da imagem
docker-compose build

# Iniciar o serviço
docker-compose up -d

# Ver logs
docker-compose logs -f
```

## Configuração

Edite o arquivo `.env` com suas credenciais:

```env
# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua-service-key

# CORS - adicione o URL do seu frontend
ALLOWED_ORIGINS=http://localhost:8080,https://seu-app.vercel.app

# Porta do servidor
PORT=3001
```

## API Endpoints

### Conexão

```bash
# Conectar usuário
POST /api/connect
{
  "userId": "uuid-do-usuario"
}

# Desconectar usuário
POST /api/disconnect
{
  "userId": "uuid-do-usuario"
}

# Status da conexão
GET /api/status/:userId
```

### Mensagens

```bash
# Enviar mensagem
POST /api/send-message
{
  "userId": "uuid-do-usuario",
  "to": "5511999999999",
  "message": "Olá!",
  "type": "text"
}

# Envio em massa
POST /api/send-bulk
{
  "userId": "uuid-do-usuario",
  "recipients": ["5511999999999", "5511888888888"],
  "message": "Mensagem em massa",
  "delay": 1000
}
```

### Utilitários

```bash
# Verificar se número tem WhatsApp
POST /api/check-number
{
  "userId": "uuid-do-usuario",
  "phoneNumber": "5511999999999"
}

# Listar conexões ativas
GET /api/connections
```

## WebSocket Events

O servidor emite os seguintes eventos via Socket.IO:

- `qr` - QR Code para autenticação
- `connection-status` - Status da conexão (connected/disconnected)
- `new-message` - Nova mensagem recebida

### Exemplo de conexão no frontend:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001');

// Entrar na sala do usuário
socket.emit('join', userId);

// Escutar QR Code
socket.on('qr', ({ qr }) => {
  // Exibir QR Code
});

// Status da conexão
socket.on('connection-status', ({ connected, phoneNumber }) => {
  console.log('Status:', connected ? 'Conectado' : 'Desconectado');
});

// Nova mensagem
socket.on('new-message', ({ from, content, pushName }) => {
  console.log(`Nova mensagem de ${pushName}: ${content}`);
});
```

## Estrutura do Banco (Supabase)

O backend cria automaticamente a tabela `whatsapp_sessions` se não existir.

Tabelas utilizadas:
- `profiles` - Perfis dos usuários
- `patients` - Pacientes/contatos
- `whatsapp_messages` - Histórico de mensagens
- `whatsapp_sessions` - Sessões do WhatsApp

## Deploy em Produção

### Opção 1: VPS com Docker

```bash
# No servidor Ubuntu/Debian
sudo apt update && sudo apt install docker.io docker-compose

# Clone o repositório
git clone seu-repo.git
cd whatsapp-backend

# Configure .env
nano .env

# Inicie com Docker
docker-compose up -d
```

### Opção 2: PM2 (sem Docker)

```bash
# Instalar PM2
npm install -g pm2

# Build
npm run build

# Iniciar com PM2
pm2 start dist/index.js --name whatsapp-backend

# Salvar configuração
pm2 save
pm2 startup
```

## Monitoramento

```bash
# Logs do Docker
docker-compose logs -f

# Status dos containers
docker-compose ps

# Logs com PM2
pm2 logs whatsapp-backend
```

## Segurança

- Use HTTPS em produção
- Configure firewall para permitir apenas portas necessárias
- Use variáveis de ambiente para credenciais
- Implemente rate limiting se necessário
- Configure backup das sessões

## Troubleshooting

### QR Code não aparece
- Verifique se o usuário está conectado ao WebSocket
- Limpe a pasta de sessão do usuário

### Mensagens não são enviadas
- Verifique se a sessão está conectada
- Confirme que o número tem WhatsApp

### Conexão cai frequentemente
- Aumente MAX_RECONNECT_ATTEMPTS
- Verifique a estabilidade da rede
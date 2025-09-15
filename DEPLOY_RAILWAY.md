# Deploy no Railway - WhatsApp Backend

## 🚀 Informações do Projeto Railway

- **Projeto**: oxy-care-whatsapp-backend
- **Project ID**: fea76941-1f34-4f4f-a4a9-189ec5a436c1
- **Service ID**: 740feb98-67d5-40ce-ab42-fb198e5a82a4
- **Environment ID**: 2dbd6347-688b-48e7-b3fc-b9d8ef795aa4

## 🌐 URLs de Acesso

### HTTP/WebSocket
- **URL**: https://whatsapp-backend-production-c6d8.up.railway.app
- **Porta**: 3001

### TCP (para conexões diretas)
- **Host**: interchange.proxy.rlwy.net
- **Porta**: 13204

## ⚠️ IMPORTANTE: Configurar Service Key do Supabase

1. Acesse o Supabase: https://supabase.com/dashboard/project/hpndqovrxosgkcejwtay
2. Vá em Settings > API
3. Copie a `service_role key` (chave de serviço)
4. No Railway, vá em Variables e atualize `SUPABASE_SERVICE_KEY`

## 📦 Deploy Manual

### Opção 1: Deploy via GitHub (Recomendado)

1. Crie um repositório no GitHub:
```bash
# Na pasta whatsapp-backend
git remote add origin https://github.com/SEU_USUARIO/oxy-whatsapp-backend.git
git branch -M main
git push -u origin main
```

2. No Railway:
   - Vá para o projeto: https://railway.app/project/fea76941-1f34-4f4f-a4a9-189ec5a436c1
   - Clique no serviço "whatsapp-backend"
   - Settings > Source > Connect GitHub
   - Selecione o repositório

### Opção 2: Deploy via Railway CLI

1. Instale o Railway CLI:
```bash
npm install -g @railway/cli
```

2. Faça login:
```bash
railway login
```

3. Link o projeto:
```bash
railway link fea76941-1f34-4f4f-a4a9-189ec5a436c1
```

4. Deploy:
```bash
railway up
```

## 🔧 Variáveis de Ambiente Configuradas

- `NODE_ENV`: production
- `PORT`: 3001
- `SUPABASE_URL`: https://hpndqovrxosgkcejwtay.supabase.co
- `SUPABASE_SERVICE_KEY`: **⚠️ PRECISA SER CONFIGURADA**
- `SESSION_PATH`: /app/sessions
- `ALLOWED_ORIGINS`: http://localhost:8080,https://oxy-care-connect.vercel.app
- `MAX_RECONNECT_ATTEMPTS`: 5
- `RECONNECT_INTERVAL`: 5000

## 📂 Volumes Persistentes

- `/app/sessions` - Armazena sessões do WhatsApp
- `/app/logs` - Armazena logs da aplicação

## 🔄 Atualizar Frontend para Usar o Backend

No frontend (Vercel), atualize a URL do backend:

```javascript
// src/config/api.js ou similar
const BACKEND_URL = process.env.NODE_ENV === 'production'
  ? 'https://whatsapp-backend-production-c6d8.up.railway.app'
  : 'http://localhost:3001';
```

Ou adicione nas variáveis de ambiente do Vercel:
```
VITE_WHATSAPP_BACKEND_URL=https://whatsapp-backend-production-c6d8.up.railway.app
```

## 📊 Monitoramento

### Ver Logs
- Acesse: https://railway.app/project/fea76941-1f34-4f4f-a4a9-189ec5a436c1/service/740feb98-67d5-40ce-ab42-fb198e5a82a4
- Clique em "Logs"

### Métricas
- CPU, Memória e Network disponíveis no dashboard do Railway

## 🧪 Testar a Conexão

```bash
# Teste de saúde
curl https://whatsapp-backend-production-c6d8.up.railway.app/health

# Teste de conexão WebSocket
npm install -g wscat
wscat -c wss://whatsapp-backend-production-c6d8.up.railway.app
```

## 🐛 Troubleshooting

### Erro de Build
- Verifique os logs de build no Railway
- Certifique-se que o Dockerfile está correto

### Erro de Conexão com Supabase
- Verifique se a SERVICE_KEY está configurada
- Confirme que a URL do Supabase está correta

### WhatsApp não conecta
- Verifique os logs para ver o QR Code
- Confirme que o volume /app/sessions está montado
- Tente limpar a sessão e reconectar

## 🔒 Segurança

1. **Service Key**: Nunca exponha a service key do Supabase
2. **CORS**: Configure apenas os domínios necessários
3. **Rate Limiting**: Considere adicionar rate limiting em produção
4. **HTTPS**: Sempre use HTTPS em produção (Railway fornece automaticamente)

## 📝 Próximos Passos

1. ✅ Configurar a SERVICE_KEY do Supabase no Railway
2. ✅ Fazer push do código para o GitHub
3. ✅ Conectar o GitHub ao Railway
4. ✅ Aguardar o deploy automático
5. ✅ Testar a conexão
6. ✅ Atualizar o frontend com a nova URL
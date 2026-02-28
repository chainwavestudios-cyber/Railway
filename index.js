import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Satisfy Railway Healthcheck
app.get('/health', (req, res) => res.status(200).send('ok'));

wss.on('connection', (ws) => {
  console.log("🚀 Twilio Connected to Railway!");

  let dgWs = null;

  ws.on('message', (message) => {
    const msg = JSON.parse(message);

    if (msg.event === 'start') {
      const streamSid = msg.start.streamSid;
      
      // Connect to Deepgram (Uses your Railway Environment Variable)
      dgWs = new WebSocket(`wss://agent.deepgram.com/v1/agent/converse?token=${process.env.DEEPGRAM_API_KEY}`);

      dgWs.on('open', () => {
        dgWs.send(JSON.stringify({
          type: 'Settings',
          audio: {
            input: { encoding: 'mulaw', sample_rate: 8000 },
            output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
          },
          agent: {
            think: { 
              provider: { type: 'open_ai', model: 'gpt-4o-mini' }, 
              instructions: "You are a helpful AI assistant. Answer in one short sentence." 
            },
            speak: { model: 'aura-2-thalia-en' }
          }
        }));
      });

      dgWs.on('message', (data) => {
        if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: data.toString('base64') } }));
        }
      });
    }

    if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
      dgWs.send(Buffer.from(msg.media.payload, 'base64'));
    }
  });

  ws.on('close', () => dgWs?.close());
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`Engine live on ${PORT}`));

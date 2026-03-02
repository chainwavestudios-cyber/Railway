import express from 'express';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/* ==============================
   ✅ RAILWAY HEALTHCHECK ROUTE
============================== */
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

/* ==============================
   ✅ START SERVER (RAILWAY SAFE)
============================== */
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Railway AI Agent running on port ${PORT}`);
});

/* ==============================
   WEBSOCKET SERVER
============================== */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('🔌 Twilio connected');

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parameters = Object.fromEntries(url.searchParams.entries());

  const campaignId = parameters.c || 'unknown_campaign';
  const leadId = parameters.l || 'unknown_lead';
  const firstName = parameters.f || 'there';
  const isInbound = parameters.inbound === 'true';

  console.log(`📞 Campaign: ${campaignId}`);
  console.log(`👤 Lead: ${leadId}`);
  console.log(`📥 Inbound: ${isInbound}`);

  // ==============================
  // PROMPTS
  // ==============================

  const outboundPrompt = `
You are Orion, an elite senior SDR setting appointments for Chris, a Senior Strategy Advisor.
... (unchanged)
`;

  const inboundPrompt = `
You are Orion returning a missed call on behalf of Chris, a Senior Strategy Advisor.
... (unchanged)
`;

  const promptToUse = isInbound ? inboundPrompt : outboundPrompt;

  // ==============================
  // CONNECT TO DEEPGRAM AGENT
  // ==============================

  const dgWs = new WebSocket(
    'wss://agent.deepgram.com/v1/agent',
    {
      headers: {
        Authorization: \`Token \${process.env.DEEPGRAM_API_KEY}\`
      }
    }
  );

  dgWs.on('open', () => {
    console.log('🧠 Connected to Deepgram');

    dgWs.send(JSON.stringify({
      type: 'Settings',
      audio: {
        input: { encoding: 'mulaw', sample_rate: 8000 },
        output: { encoding: 'mulaw', sample_rate: 8000 }
      },
      agent: {
        listen: {
          provider: { type: 'deepgram', model: 'flux-general-en' }
        },
        think: {
          provider: { type: 'open_ai', model: 'gpt-4.1-nano' },
          prompt: promptToUse
        },
        speak: isInbound
          ? {
              provider: { type: 'deepgram', model: 'aura-2-thalia-en' }
            }
          : {
              provider: {
                type: 'cartesia',
                model_id: 'sonic-2',
                voice: {
                  mode: 'id',
                  id: 'baad9eb9-b2f4-474d-8cb7-1926b9db84ca'
                },
                language: 'en'
              },
              endpoint: {
                url: 'https://api.cartesia.ai/tts/bytes',
                headers: {
                  'x-api-key': process.env.CARTESIA_API_KEY
                }
              }
            }
      }
    }));

    if (isInbound) {
      dgWs.send(JSON.stringify({
        type: 'UserText',
        text: 'Begin the call now.'
      }));
    }
  });

  // ==============================
  // TWILIO <-> DEEPGRAM AUDIO PIPE
  // ==============================

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.event === 'media') {
      dgWs.send(JSON.stringify({
        type: 'Audio',
        audio: data.media.payload
      }));
    }
  });

  dgWs.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.type === 'Audio') {
      ws.send(JSON.stringify({
        event: 'media',
        media: { payload: data.audio }
      }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 Twilio disconnected');
    dgWs.close();
  });

  dgWs.on('close', () => {
    console.log('🧠 Deepgram disconnected');
    ws.close();
  });
});

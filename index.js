import express from 'express';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/* ==============================
   RAILWAY HEALTHCHECK ROUTE
============================== */
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

/* ==============================
   START SERVER (RAILWAY SAFE)
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

Rules:
- DO NOT ask for their email.
- DO NOT confirm time zones.
- DO NOT book exact times.
- Only confirm a DAY and AM or PM.
- Once agreed, end call politely.

Opening:
Hi ${firstName}, this is Orion calling on behalf of Chris, one of our Senior Strategy Advisors.

He is issuing an urgent market alert. He believes he has identified a historic technical setup that could trigger a major surge in the silver market in the coming weeks.

He’s not available this second, but wanted to schedule a quick 5-10 minute call with you.

Are you available later today or tomorrow? What works best, mornings or afternoons?

If yes:
Perfect. I’ll make sure Chris gives you a call then. I can also have him send you his bi-weekly newsletter he personally writes. Sound good?

OBJECTIONS:

Too late:
"I understand that concern. But look at Bitcoin at ten thousand — it was a gift in hindsight. Silver is backed by a 6-year structural supply deficit from EV, solar, and AI industries. The real squeeze hasn't even started yet."

Silver ran up:
"It’s similar to NVIDIA in 2024. Everyone expected a correction, yet growth continued because demand was structural. Silver supply cannot scale quickly."

What is the play:
"Chris recommends an 8-week dollar-cost averaging strategy before the supply squeeze fully materializes."

After rebuttal:
Chris can explain it much better during your call. I think it will make a lot of sense. Would later today or tomorrow morning or afternoon work best?
`;

  const inboundPrompt = `
You are Orion returning a missed call on behalf of Chris, a Senior Strategy Advisor.

Rules:
- DO NOT ask for their email.
- DO NOT confirm time zones.
- DO NOT book exact times.
- Only confirm a DAY and AM or PM.
- Once meeting and newsletter are agreed to, end call immediately.
- Do not go off script unless objection or question.

Vocal Style:
Confident, smooth, energetic, natural flow.

Opening:
Chris was trying to reach you. He is issuing an urgent market alert to his clients. He believes he has identified a historic technical setup that could trigger a major surge in silver in the coming weeks.

He’s not available this second, but would love to schedule a quick 5-10 minute call to explain it.

Are you available later today or tomorrow? What works best, mornings or afternoons?

If yes:
I’ll make sure Chris gives you a call then. I can also have him send you his bi-weekly newsletter he personally writes. Sound good?

OBJECTIONS:

Too late:
"I understand that concern. Silver is backed by a 6-year structural supply deficit from EV, solar, and AI industries. The real supply crunch hasn't even hit yet."

Silver ran up:
"Many expected a correction, but the growth is structural. Supply cannot scale quickly."

What is the play:
"Chris recommends an 8-week dollar-cost averaging strategy before the supply squeeze fully materializes."

After rebuttal:
Chris can explain it much better during your call. Would later today or tomorrow morning or afternoon work best?
`;

  const promptToUse = isInbound ? inboundPrompt : outboundPrompt;

  // ==============================
  // CONNECT TO DEEPGRAM AGENT
  // ==============================

  const dgWs = new WebSocket(
    'wss://agent.deepgram.com/v1/agent',
    {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`
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
        media: {
          payload: data.audio
        }
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

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const ZAPIER_WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/26634868/u0iagvf/";

const server = http.createServer((req, res) => {
  // 1. THIS REPLACES BASE44 - Twilio hits this URL for instructions
  if (req.url === '/twilio-hook') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${req.headers.host}" />
        </Connect>
        <Pause length="40" />
      </Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  // 2. HEALTH CHECK - Stops Railway from killing the container
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ALIVE');
    return;
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('--- [Twilio] Connected ---');
  let dgWs = null;
  let streamSid = null;
  let callStartTime = Date.now();

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        const apiKey = process.env.DEEPGRAM_API_KEY;
        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse?token=' + apiKey);

        dgWs.on('open', () => {
          console.log('--- [Deepgram] AI Ready ---');
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, instructions: "You are a helpful assistant. Keep answers concise." },
              speak: { model: 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', (dgData) => {
          if (dgData instanceof Buffer && twilioWs.readyState === 1) {
            twilioWs.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: dgData.toString('base64') } }));
          }
        });
      }
      if (msg.event === 'media' && dgWs && dgWs.readyState === 1) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }
    } catch (e) { console.error('Error:', e.message); }
  });

  twilioWs.on('close', async () => {
    console.log('--- [Twilio] Closed ---');
    if (dgWs) dgWs.close();
    try {
      await fetch(ZAPIER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: "completed", streamSid: streamSid, duration: Math.floor((Date.now() - callStartTime) / 1000) })
      });
    } catch (err) { console.error("Zapier error:", err.message); }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('SERVER LIVE ON PORT ' + PORT);
});

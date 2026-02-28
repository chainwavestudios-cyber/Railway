const WebSocket = require('ws');
const http = require('http');

// Railway provides the PORT variable; we MUST use it.
const PORT = process.env.PORT || 8080;

// 1. IMPROVED HEALTH CHECK
// Railway hits this URL to see if the app is "alive." 
// If we don't answer, they kill the container.
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ALIVE');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('--- [Twilio] Connected ---');
  
  let dgWs = null;
  let streamSid = null;

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('--- [Twilio] Stream Started: ' + streamSid);
        
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
              think: { 
                provider: { type: 'open_ai', model: 'gpt-4o-mini' }, 
                instructions: "You are a helpful assistant. Keep answers concise." 
              },
              speak: { model: 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', (dgData) => {
          if (dgData instanceof Buffer && twilioWs.readyState === 1) {
            twilioWs.send(JSON.stringify({ 
              event: 'media', 
              streamSid: streamSid, 
              media: { payload: dgData.toString('base64') } 
            }));
          }
        });
      }

      if (msg.event === 'media' && dgWs && dgWs.readyState === 1) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        dgWs.send(audioBuffer);
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  });

  twilioWs.on('close', () => {
    console.log('--- [Twilio] Closed ---');
    if (dgWs) dgWs.close();
  });
});

// Start the server and bind to 0.0.0.0 (important for Railway)
server.listen(PORT, '0.0.0.0', () => {
  console.log('SERVER LIVE ON PORT ' + PORT);
});

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// 1. Basic HTTP server so Railway doesn't crash
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Railway WebSocket Server is running');
});

// 2. The WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('--- [Twilio] Call Connected ---');
  let dgWs = null;
  let streamSid = null;

  twilioWs.on('message', async (data) => {
    // THIS is where "data" actually comes from
    const msg = JSON.parse(data);

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      console.log('--- [Twilio] Stream Started ---');
      
      const apiKey = process.env.DEEPGRAM_API_KEY;
      dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse?token=' + apiKey);

      dgWs.on('open', () => {
        console.log('--- [Deepgram] AI Agent Ready ---');
        dgWs.send(JSON.stringify({
          type: 'Settings',
          audio: {
            input: { encoding: 'mulaw', sample_rate: 8000 },
            output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
          },
          agent: {
            think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, instructions: "Keep answers brief." },
            speak: { model: 'aura-2-thalia-en' }
          }
        }));
      });

      dgWs.on('message', (dgData) => {
        if (dgData instanceof Buffer && twilioWs.readyState === 1) {
          twilioWs.

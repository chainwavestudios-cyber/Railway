const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Server is running");
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('--- [Twilio] Call Connected ---');
  let dgWs = null;
  let streamSid = null;

  twilioWs.on('message', async (data) => {
    const msg = JSON.parse(data);

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      console.log(`--- [Twilio] Stream Started: ${streamSid} ---`);

      // Connect to Deepgram Agent
      const apiKey = process.env.DEEPGRAM_API_KEY;
      dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse?token=' + apiKey);

      dgWs.on('open', () => {
        console.log('--- [Deepgram] Connection Open ---');
        // Configure the Agent
        dgWs.send(JSON.stringify({
          type: 'Settings',
          audio: {
            input: { encoding: 'mulaw', sample_rate: 8000 },
            output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
          },
          agent: {
            think: {
              provider: { type: 'open_ai', model: 'gpt-4o-mini' },
              instructions: "You are a helpful phone assistant. Keep answers brief."
            },
            speak: { model: 'aura-2-thalia-en' }
          }
        }));
      });

      dgWs.on('message', (dgData) => {
        // If Deepgram sends audio, send it to Twilio
        if (dgData instanceof Buffer && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: dgData.toString('base64') }
          }));
        }
      });
    }

    if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
      // Forward Twilio audio to Deepgram
      const audioBuffer = Buffer.from(msg.media.payload, 'base64');
      dgWs.send(audioBuffer);
    }
  });

  twilioWs.on('close', () => {
    console.log('--- [Twilio] Call Ended ---');
    dgWs?.close();
  });
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));

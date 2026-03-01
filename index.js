import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Satisfy Railway Healthcheck
app.get('/health', (req, res) => res.status(200).send('ok'));

wss.on('connection', (ws, req) => {
  // Extract Campaign ID and Lead ID from the connection URL
  const parameters = url.parse(req.url, true).query;
  const campaignId = parameters.c || 'unknown_campaign';
  const leadId = parameters.l || 'unknown_lead';

  console.log(`🚀 Twilio Connected! Campaign: ${campaignId} | Lead: ${leadId}`);

  let dgWs = null;
  let streamSid = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log(`Stream started: ${streamSid}`);

        // 1. Connect to Deepgram using HEADERS to fix the 401 error
        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`
          }
        });

        dgWs.on('open', () => {
          console.log("✅ Deepgram Authenticated & Connected!");
          
          // 2. Send Initial Settings with the "Chris / Silver Squeeze" instructions
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: { 
                provider: { type: 'open_ai', model: 'gpt-4o-mini' }, 
                instructions: `You are a high-conviction SDR working for Chris at Corventa Metals. Chris has 20 years experience. 
                Your goal: Qualify the lead and ask for a 5-10 min call 'tomorrow afternoon'. 
                Reference: The Silver Squeeze, AI data center demand, and the Bitcoin $10k comparison.
                If they agree, tell them Chris will call, then end the call.`
              },
              speak: { model: 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', (data) => {
          // Only send Binary (Audio) data back to Twilio. Ignore JSON metadata.
          if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN && streamSid) {
            ws.send(JSON.stringify({ 
              event: 'media', 
              streamSid, 
              media: { payload: data.toString('base64') } 
            }));
          } else {
            // Log non-audio messages (transcripts/metadata) for debugging
            console.log("DG Metadata:", data.toString());
          }
        });

        dgWs.on('error', (err) => console.error("❌ Deepgram WebSocket Error:", err.message));
        dgWs.on('close', () => console.log("Deepgram connection closed."));
      }

      // 3. Forward human audio from Twilio to Deepgram
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }

      if (msg.event === 'stop') {
        console.log(`Stream ${streamSid} stopped.`);
      }

    } catch (e) {
      console.error("Error processing Twilio message:", e);
    }
  });

  ws.on('close', () => {
    console.log(`📴 Connection closed for Campaign: ${campaignId}`);
    dgWs?.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Engine live on ${PORT}`);
  console.log(`Monitoring for Campaign IDs...`);
});

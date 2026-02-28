import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createClient } from '@base44/sdk';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const base44 = createClient({
  appId: process.env.BASE44_APP_ID, 
  token: process.env.BASE44_ADMIN_TOKEN, 
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const campaignId = url.searchParams.get('c');
  const leadId = url.searchParams.get('l');

  console.log(`[Railway] Connection: Campaign ${campaignId}, Lead ${leadId}`);

  let dgWs = null;
  let streamSid = null;
  let fullTranscript = "";

  try {
    // SAFETY: Try to fetch, but handle "Test" IDs gracefully
    let campaign = null;
    let lead = null;
    
    try {
      const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
      campaign = campaigns[0];
      const leads = await base44.entities.Lead.filter({ id: leadId });
      lead = leads[0];
    } catch (dbErr) {
      console.log("[Railway] DB Lookup failed, using Test Defaults");
    }

    // Default prompt if IDs aren't found in Base44
    const instructions = campaign?.agent_prompt || "You are a helpful AI assistant. This is a test call.";
    const voice = campaign?.agent_voice || 'aura-2-thalia-en';

    ws.on('message', async (message) => {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
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
                instructions: instructions 
              },
              speak: { model: voice }
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

  } catch (err) {
    console.error("Critical Engine Error:", err.message);
    ws.close();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`Engine live on ${PORT}`));

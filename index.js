import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 1. Scalable Error Catching (Forces logs to show up in Railway)
process.on('uncaughtException', (err) => console.error('🔥 CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('System Live'));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const campaignId = parameters.c || 'none';
  const leadId = parameters.l || 'none';
  
  // SCALE UP: Get the key from the URL. Fallback to process.env if testing.
  const dynamicApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;

  console.log(`🚀 New Call | Campaign: ${campaignId} | Lead: ${leadId}`);

  let dgWs = null;
  let streamSid = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        
        // 2. The Auth Fix: Use the dynamic key in a Header-based Handshake
        dgWs = new WebSocket('wss://api.deepgram.com/v1/agent/converse', {
          headers: { 'Authorization': `Token ${dynamicApiKey}` }
        });

        dgWs.on('open', () => {
          console.log(`✅ Deepgram Auth Successful for Lead: ${leadId}`);
          
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt: `You are Chris's Senior SDR at Corventa Metals. Follow the "Silver Squeeze" script. Use the 'mark_as_qualified' tool when they agree to a 5-min chat.`
              },
              speak: { model: 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', (data) => {
          const dgMsg = JSON.parse(data.toString());

          // Handle Tool Calls (The Bridge to Pipedrive)
          if (dgMsg.type === 'FunctionCallRequest') {
            const tool = dgMsg.functions[0];
            console.log(`🛠️ Tool Triggered: ${tool.name}`);
            
            // Post back to Base44 to sync Pipedrive & Send SMS
            fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool: tool.name, lead_id: leadId, campaign_id: campaignId })
            }).catch(e => console.error("Sync Error:", e));

            dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: tool.id, name: tool.name, content: "{\"status\":\"success\"}" }));
          }

          // Handle Audio Streaming
          if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN && streamSid) {
            ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: data.toString('base64') } }));
          }
        });

        dgWs.on('error', (e) => console.error("❌ Deepgram Handshake Failed:", e.message));
      }

      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }

    } catch (err) {
      console.error("Processing Error:", err);
    }
  });

  ws.on('close', () => {
    console.log(`📴 Call Finished: ${leadId}`);
    dgWs?.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Server Running on ${PORT}`));

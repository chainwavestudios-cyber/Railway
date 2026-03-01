import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

process.on('uncaughtException', (err) => console.error('🔥 CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('System Live'));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const campaignId = parameters.c || 'none';
  const leadId = parameters.l || 'none';
  const dynamicApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;

  console.log(`🚀 New Call | Campaign: ${campaignId} | Lead: ${leadId}`);

  let dgWs = null;
  let streamSid = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log(`📞 Stream started: ${streamSid}`);

        // 1. WebSocket connection using Header Auth
        dgWs = new WebSocket('wss://api.deepgram.com/v1/agent/converse', {
          headers: { 'Authorization': `Token ${dynamicApiKey}` }
        });

        dgWs.on('open', () => {
          console.log(`✅ Deepgram connected for Lead: ${leadId}`);

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                instructions: `
                  # ROLE
                  You are a professional SDR for Chris, a Senior Advisor at Corventa Metals. 
                  Chris has 20 years experience. You are confident and data-driven.
                  
                  # SCRIPT
                  - Hook: Ask for the lead. "Hope I haven't taken you away from anything important?"
                  - Reason: Chris has a high-conviction play in Silver based on tangible data.
                  - The Ask: Can they squeeze in 5-10 mins tomorrow or the next day to hear the strategy?

                  # OBJECTIONS
                  - If they say "Silver is at the top": Compare it to Bitcoin at $10k. 
                  - Mention the AI data center and solar demand "squeeze."
                  - Mention the Rick Harrison (Pawn Stars) Fox News interview about supply shortages.

                  # CLOSING
                  - If they agree: Call 'mark_as_qualified' and say Chris will follow up.
                  - If they want the data: Call 'send_newsletter' and send the video.
                  - End the call professionally.
                `
              },
              speak: { model: 'aura-2-thalia-en' },
              functions: [
                {
                  name: "mark_as_qualified",
                  description: "Lead agrees to a 5-10 minute call with Chris."
                },
                {
                  name: "send_newsletter",
                  description: "Lead wants the Rick Harrison silver video."
                }
              ]
            }
          }));
        });

        dgWs.on('message', (data, isBinary) => {
          // 2. Handle Binary Audio (RAW Deepgram Output)
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              const payload = data.toString('base64');
              ws.send(JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload }
              }));
            }
            return;
          }

          // 3. Handle JSON Messages (Metadata & Tools)
          try {
            const dgMsg = JSON.parse(data.toString());

            if (dgMsg.type === 'FunctionCallRequest') {
              const tool = dgMsg.functions[0];
              console.log(`🛠️ Tool Triggered: ${tool.name}`);

              fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: tool.name, lead_id: leadId, campaign_id: campaignId })
              }).catch(e => console.error("Sync Error:", e));

              dgWs.send(JSON.stringify({
                type: 'FunctionCallResponse',
                id: tool.id,
                name: tool.name,
                content: JSON.stringify({ status: 'success' })
              }));
            }
          } catch (e) {
            // Log non-critical metadata
          }
        });

        dgWs.on('error', (e) => console.error("❌ Deepgram Error:", e.message));
        dgWs.on('close', (code, reason) => console.log(`🔌 Deepgram closed: ${code} ${reason}`));
      }

      // 4. Forward Human Audio (Twilio -> Deepgram)
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }

      // 5. Clean Stop Event
      if (msg.event === 'stop') {
        console.log(`🛑 Stream stopped: ${streamSid}`);
        dgWs?.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error("Processing Error:", err);
    }
  });

  ws.on('close', (code) => {
    console.log(`📴 Twilio disconnected (${code})`);
    if (dgWs && dgWs.readyState === WebSocket.OPEN) {
      dgWs.close(1000, 'Twilio call ended');
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Server Running on ${PORT}`));

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
  let keepAliveInterval = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log(`📞 Stream started: ${streamSid}`);

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { 'Authorization': `Token ${dynamicApiKey}` }
        });

        dgWs.on('open', () => {
          console.log(`✅ Deepgram connected for Lead: ${leadId}`);

          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          // ✅ FINAL SPEC: prompt as string + functions inside think
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: { provider: { type: 'deepgram', model: 'nova-3' } },
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt: `
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
                  - If they agree: Call mark_as_qualified and say Chris will follow up.
                  - If they want the data: Call send_newsletter and send the video.
                  - End the call professionally.
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Lead agrees to a 5-10 minute call with Chris.",
                    parameters: { type: "object", properties: {}, required: [] }
                  },
                  {
                    name: "send_newsletter",
                    description: "Lead wants the Rick Harrison silver video.",
                    parameters: { type: "object", properties: {}, required: [] }
                  }
                ]
              },
              speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
              greeting: "Hello, is this a good time to talk?"
            }
          }));
        });

        dgWs.on('message', (data, isBinary) => {
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              ws.send(JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: data.toString('base64') }
              }));
            }
            return;
          }

          try {
            const dgMsg = JSON.parse(data.toString());

            if (dgMsg.type === 'ConversationText') {
              console.log(`💬 ${dgMsg.role}: ${dgMsg.content}`);
            }

            if (dgMsg.type === 'Error') {
              console.error(`❌ DG Error Event:`, JSON.stringify(dgMsg));
            }

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                console.log(`🛠️ Tool Triggered: ${call.name}`);

                fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tool: call.name, lead_id: leadId, campaign_id: campaignId })
                }).catch(e => console.error("Sync Error:", e));

                dgWs.send(JSON.stringify({
                  type: 'FunctionCallResponse',
                  id: call.id,
                  name: call.name,
                  content: JSON.stringify({ status: 'success' })
                }));
              }
            }
          } catch (e) { }
        });

        dgWs.on('error', (e) => console.error("❌ Deepgram Error:", e.message, e));
        dgWs.on('close', (code, reason) => {
          console.log(`🔌 Deepgram closed: ${code} ${reason}`);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      if (msg.event === 'stop') {
        console.log(`🛑 Stream stopped: ${streamSid}`);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        dgWs?.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error("Processing Error:", err);
    }
  });

  ws.on('close', (code) => {
    console.log(`📴 Twilio disconnected (${code})`);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000, 'Twilio call ended');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Server Running on ${PORT}`));

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
  const firstName = parameters.f || 'there'; 
  const leadId = parameters.l || 'none';
  const campaignId = parameters.c || 'none';
  const dynamicApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;

  console.log(`🚀 New Call | Lead: ${firstName} | Campaign: ${campaignId}`);

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
          console.log(`✅ Deepgram connected for Lead: ${firstName}`);

          // ✅ Keep-Alive to prevent timeouts
          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          // ✅ SETTINGS: Fixed model name & removed invalid conversation_config
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: { 
                provider: { type: 'deepgram', model: 'flux-general-en' } 
              },
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt: `
                  # ROLE
                  You are Orion, a high-conviction Senior SDR at Corventa Metals.
                  
                  # DYNAMIC INFO
                  - The person you are calling is: ${firstName}.
                  
                  # STYLE
                  - Speak with authority but keep it consultative.
                  - **DO NOT SPEAK FIRST**. Wait for a "Hello" or sound from the user.
                  - Use natural fillers like "Uh," "Look," or "Honestly."
                  - Use bolding in your output for emphasis (e.g., "**massive** opportunity").

                  # SCRIPT FLOW
                  - Wait for "Hello."
                  - Say: "Hi... is this ${firstName}?"
                  - When they confirm, say: "Great. Look, ${firstName}—this is Orion with Corventa. I hope I'm not taking you away from anything *too* important?"
                  - Pitch the Silver Squeeze. If they want a follow-up call, trigger 'mark_as_qualified'.
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Lead agrees to a follow-up call. Create an appointment entry.",
                    parameters: { type: "object", properties: {} }
                  }
                ]
              },
              speak: { 
                provider: { type: 'deepgram', model: 'aura-2-orion-en' } 
              }
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

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                console.log(`🛠️ Tool Triggered: ${call.name} for ${firstName}`);

                fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    action: "CREATE_APPOINTMENT",
                    lead_name: firstName,
                    lead_id: leadId,
                    campaign_id: campaignId,
                    tool: call.name 
                  })
                }).catch(e => console.error("App Sync Error:", e));

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

        dgWs.on('error', (e) => console.error("❌ Deepgram Error:", e.message));
        dgWs.on('close', (code, reason) => {
          console.log(`🔌 Connection closed: ${code} ${reason}`);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      if (msg.event === 'stop') {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        dgWs?.close(1000, 'Call ended');
      }

    } catch (err) { }
  });

  // ✅ Cleanup on Twilio disconnect
  ws.on('close', () => {
    console.log(`📴 Twilio disconnected`);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Orion Engine Running on ${PORT}`));

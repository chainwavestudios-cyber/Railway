updated code: review:  import express from 'express';
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

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { 'Authorization': `Token ${dynamicApiKey}` }
        });

        dgWs.on('error', (e) => console.error("❌ Deepgram Error:", e.message));
        dgWs.on('close', (code) => {
          console.log(`🔌 Deepgram closed: ${code}`);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });

        dgWs.on('open', () => {
          keepAliveInterval = setInterval(() => {
            if (dgWs?.readyState === WebSocket.OPEN) dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
          }, 5000);

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: { provider: { type: 'deepgram', model: 'flux-general-en' } },
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt: `
                  # ROLE
                  You are Orion, an enthusiastic SDR for Chris at Corventa Metals. 
                  **GOAL**: Book a call with Chris. **PRIORITY**: Same-day appointments.  Don’t try and book specific times to reduce exact confirmations.  A Date, and AM or PM follow up by Chris.  
**PRIORITY**:  DO NOT go off script, unless there are questions or rebuttals.  If you need to go off script, use the rebuttals given.
                  # KNOWLEDGE BASE (USE ONLY FOR REBUTTALS/QUESTIONS stay on script otherwise)
                  - **Supply Deficit**: We're in the 6th consecutive year of a structural deficit. The gap between what we mine and use is 67 million ounces short this year alone.
                  - **The Tech Demand**: AI Data Centers and Solar demand is so high, manufacturers are "thrifting" because they can't find enough.
                  - **Mining Reality**: Silver is a byproduct of copper/zinc mining. You can't just "mine more silver" without massive, years-long copper mine expansions.
                  - **IRAs**: A Gold/Silver IRA allows real, IRS-approved metals inside your retirement account for tax-deferred growth. Corventa streamlines setup and storage.

                  # PHASE 1: THE HOOK
                  - Wait for Hello. "Hello, may I speak with ${firstName}?"
                  - "Hi ${firstName}, I hope I haven’t taken you away from anything too important?"

                  # PHASE 2: AUTHORITY & PITCH
                  - "The reason for my call is I work for a Senior Precious Metals advisor named Chris over at Corventa. He has a high-conviction move in silver rooted in tangible data."
                  - **THE ASK**: "He wanted to see if you could squeeze in 5 to 10 minutes **later today** or tomorrow just to hear the data?"

                  # PHASE 3: OBJECTION HANDLING
                  - **If they ask "Why?" or object**: Use the Supply Deficit or Mining Reality facts above. 
                  - **Always pivot back**: "That's why Chris is so adamant about the timing. Could you do 10 minutes this afternoon?"

                  # PHASE 4: QUALIFICATION (ONLY AFTER THEY AGREE)
                  - "Great. I just need to ask a couple questions. Have you ever purchased physical precious metal before? [Wait]"
                  - "In terms of timing, do you have liquid capital ready, or can you make moves in your current portfolio? We specialize in utilizing qualified retirement accounts for tax-sheltered positions."

                  # PHASE 5: THE CLOSE
                  - "I’ve let Chris know to call you. Would you like me to send his newsletter and the Rick Harrison video? It's a great way to stay updated."
                  - [If yes]: "Perfect, I'll send that over. I've got you down for Chris to reach out."
                  - **Action**: Call 'mark_as_qualified'.
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Lead is qualified. Create appointment.",
                    parameters: {
                      type: "object",
                      properties: {
                        day: { type: "string", description: "Priority same-day" },
                        time_of_day: { type: "string", enum: ["AM", "PM"] },
                        send_email: { type: "boolean" },
                        notes: { type: "string", description: "Details on metals owned or IRA interest" }
                      }
                    }
                  }
                ]
              },
              speak: { provider: { type: 'deepgram', model: 'aura-2-orion-en' } }
            }
          }));
        });

        dgWs.on('message', (data, isBinary) => {
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: data.toString('base64') } }));
            }
            return;
          }
          try {
            const dgMsg = JSON.parse(data.toString());
            if (dgMsg.type === 'FunctionCallRequest') {
              const call = dgMsg.functions[0];
              fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  action: "CREATE_APPOINTMENT",
                  lead_name: firstName,
                  lead_id: leadId,
                  campaign_id: campaignId,
                  details: call.arguments 
                })
              }).catch(e => console.error("Sync Error:", e));
              dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: call.id, name: call.name, content: JSON.stringify({ status: 'success' }) }));
            }
          } catch (e) { }
        });
      }

      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }
      if (msg.event === 'stop') {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000);
      }
    } catch (err) { }
  });

  ws.on('close', () => {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Orion Engine Running on ${PORT}`));

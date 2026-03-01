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
You are Orion, a sharp and personable SDR calling on behalf of Chris, a Senior Precious Metals advisor at Corventa Metals.

**CRITICAL RULE**: Stay strictly on script. Only deviate to handle a direct question or rebuttal. After handling it, return to the script immediately.

---

# PHASE 1: THE OPEN
- Wait silently until the prospect speaks first.
- Say: "Hello, may I speak with ${firstName}?"
- [They confirm] Say: "Hi ${firstName}, I hope I haven't taken you away from anything too important?"

## IF THEY SAY THEY ARE BUSY:
- Say: "${firstName}, please excuse the timing. I work with Chris at Corventa Metals, and he asked me to reach out regarding a specific technical setup in the metals market that he doesn't want you to miss. Since I caught you in the middle of something, when would be a better window to give you a quick 2-minute update?"

---

# PHASE 2: THE AUTHORITY BUILDER
- Say: "The reason for my call is I work for a Senior Precious Metals advisor named Chris over at Corventa Metals. Chris has over 20 years of experience in these markets, and right now, he's using every single outlet he has to meet as many new people as possible."
- Say: "He absolutely believes that for a financial relationship to really work, you have to start with a true winning play. Right now, he has a high-conviction move in the silver markets that is rooted in tangible data you can actually see and measure."
- Say: "Timing is critical here, no question—so he wanted me to reach out and see if you could squeeze in 5 to 10 minutes in the next day or so just to hear some of his ideas?"

---

# PHASE 3: OBJECTION HANDLING (ONLY USE WHEN NEEDED, THEN RETURN TO SCRIPT)

## If they hesitate because silver price seems high:
- Say: "I totally get that—it's had a strong run. But remember when Bitcoin hit $10,000? Everyone thought that was the top, too. The difference here is utility and market consolidation. After the big run up, we've seen steady consolidation, and now major buying from institutions. We're looking at a structural supply squeeze driven by AI data centers, solar energy, and electric vehicle demand. The demand for silver is increasing at a far faster pace than we can produce it. In fact, I'll shoot you a newsletter Chris wrote—it features a Fox News interview with Rick Harrison from Pawn Stars. He's been in this for 40 years and he's seeing the same shortages we are. What Chris really wants his investors to know is: you're not late to the party, you're actually early. He just wants to show you why this high might actually be the last floor."

## If they ask "What's the play exactly?":
- Give ONE teaser sentence: "It's a structural supply squeeze in silver—sixth consecutive year of a deficit, with AI and solar demand accelerating faster than mining can keep up." Then pivot: "That's exactly what Chris wants to walk you through. Could you do 10 minutes this afternoon or tomorrow?"

## If they say "Not interested":
- Say: "No problem at all, ${firstName}. I appreciate your time and I hope you have a great day." Then end the call.

---

# PHASE 4: QUALIFICATION (ONLY AFTER THEY AGREE TO A CALL)
- Say: "${firstName}, I just need to ask you a couple quick questions before I confirm with Chris."
- Ask: "Have you ever purchased physical precious metal before?" [Wait for answer]
- Ask: "In terms of timing—which is critical right now—do you have liquid capital ready for a metals investment, or can you make moves in your current portfolio? Just so you know, we specialize in utilizing qualified retirement accounts for a tax-sheltered metals position."

---

# PHASE 5: THE CLOSE
- Say: "Thanks for that info, ${firstName}. I've let Chris know to give you a call. In the meantime, would you like me to send over his bi-weekly newsletter and some information on our company? It's something he personally writes every few weeks—a great way to stay updated on current market shifts while you wait to connect."
- [If yes] Say: "Perfect, I'll get that sent over to your inbox today."
- **Do NOT ask for their email address unless they bring it up first.**
- **Call 'mark_as_qualified' now.**

---

# SCHEDULING NOTES
- Priority: same-day or next-day. Keep it casual—just confirm the DAY and AM or PM.
- Don't over-confirm. One simple close: "Should I put you down for [day], [AM/PM]?"
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Lead has agreed to a follow-up call with Chris. Book the appointment.",
                    parameters: {
                      type: "object",
                      properties: {
                        day: { type: "string", description: "The agreed day, e.g. 'today', 'tomorrow', 'Monday'" },
                        time_of_day: { type: "string", enum: ["AM", "PM"], description: "Morning or afternoon" },
                        send_email: { type: "boolean", description: "True if lead agreed to receive the newsletter" },
                        notes: { type: "string", description: "Any relevant details: metals previously owned, IRA interest, etc." }
                      },
                      required: ["day", "time_of_day", "send_email"]
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
            if (dgMsg.type === 'ConversationText') {
              console.log(`💬 ${dgMsg.role}: ${dgMsg.content}`);
            }
            if (dgMsg.type === 'FunctionCallRequest') {
              const call = dgMsg.functions[0];
              console.log(`🛠️ Qualifying ${firstName}: ${JSON.stringify(call.arguments)}`);
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

import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* -------------------------------------------------------
   GLOBAL SAFETY HANDLERS
------------------------------------------------------- */
process.on('uncaughtException', (err) => console.error('🔥 CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ UNHANDLED REJECTION:', reason));

/* -------------------------------------------------------
   HEALTH CHECK
------------------------------------------------------- */
app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

/* -------------------------------------------------------
   MAIN WEBSOCKET SERVER
------------------------------------------------------- */
wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'there';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const deepgramApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;
  let firstAudioReceived = false;

  /* -------------------------------------------------------
     HANDLE INCOMING MESSAGES
  ------------------------------------------------------- */
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      /* -----------------------------
         CALL START
      ----------------------------- */
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        /* -----------------------------
           CONNECTION OPEN
        ----------------------------- */
        dgWs.on('open', () => {
          console.log(`✅ Connected to Deepgram | Lead: ${leadId}`);

          // Keepalive ping every 5s
          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: {
                encoding: 'mulaw',
                sample_rate: 8000
              },
              output: {
                encoding: 'mulaw',
                sample_rate: 8000,
                container: 'none'
              }
            },
            agent: {
              listen: {
                provider: {
                  type: 'deepgram',
                  model: 'flux-general-en',
                  version: 'v2'
                }
              },
              think: {
                provider: {
                  type: 'anthropic',
                  model: 'claude-haiku-4-5'
                },
                prompt: `You are Orion, a sharp and natural-sounding outbound SDR calling on behalf of Chris, a Senior Precious Metals Advisor at Corventa Metals.

====================================================
VOICE DELIVERY RULES — CRITICAL
====================================================
- You sound like a calm, confident, real human. Never robotic or rushed.
- Use SSML tags for natural delivery at all times:
  - <break time="400ms"/> for a natural pause between thoughts
  - <break time="700ms"/> for a dramatic pause before a key point
  - <emphasis level="strong">word</emphasis> to stress important words
  - <prosody rate="slow">text</prosody> to slow down for weight and gravity
  - <prosody rate="fast">text</prosody> to speed up for energy and momentum
  - <prosody volume="soft">text</prosody> for a more intimate, leaning-in tone
- Short sentences. Let pauses do the work.
- Never read the script — have a conversation.
- Respond quickly. Never stall.

====================================================
ABSOLUTE RULES
====================================================
1. NEVER speak first. Wait for the prospect to speak.
2. If nobody speaks for 2 full sentences worth of silence, then say: "Hello, may I speak with ${firstName}?"
3. The moment the prospect says hello or anything — immediately respond with ONLY: "Hello, may I speak with ${firstName}?"
4. Stay strictly on script at all times.
5. Only deviate for a direct question or direct objection — then return to script immediately.
6. Your ONLY goal is to book a call.
7. Only confirm DAY and AM or PM — nothing else.
8. Priority is same day or next day.
9. Do NOT over-explain. Do NOT ramble.
10. Do NOT bring up email unless they do.
11. Once booked, call function mark_as_qualified.
12. If they agreed to receive the newsletter, set send_email to true in the function call.

====================================================
PHASE 1 — OPEN
====================================================
Wait for the prospect to speak first.
The moment they say anything, respond ONLY with:
"Hello, <break time="300ms"/> may I speak with ${firstName}?"

After they confirm it's them:
"Hi ${firstName}. <break time="400ms"/> I hope I haven't taken you away from anything too important?"

If they say yes, they're busy or it's a bad time:
"${firstName}, <break time="300ms"/> sorry to catch you at a bad time. <break time="400ms"/> I'm Chris's digital assistant — he's a <emphasis level="strong">Senior Advisor</emphasis> at Corventa Metals, and he asked me to reach out about a <emphasis level="strong">high-conviction market setup.</emphasis> <break time="500ms"/> When's a better window to chat? <break time="300ms"/> If the strategy fits, we can coordinate a follow-up from there."
Then stop. Wait.

====================================================
PHASE 2 — AUTHORITY BUILDER
====================================================
"Ok great. <break time="400ms"/> The reason for my call — our Senior Strategy Advisor Chris is issuing an <emphasis level="strong">urgent market alert</emphasis> to his clients. <break time="500ms"/> He's identifying a <prosody rate="slow">historic technical setup</prosody> that suggests a <emphasis level="strong">major surge in silver</emphasis> is imminent."

<break time="500ms"/>

"Chris has navigated this sector for <emphasis level="strong">over 20 years,</emphasis> and he's specifically looking to open his private strategy to a <prosody rate="slow">select group of new clients</prosody> while this window is still open."

<break time="400ms"/>

"Chris believes in leading with value — <break time="300ms"/> specifically, a sophisticated winning play to start the relationship. <break time="400ms"/> He has a <emphasis level="strong">high-conviction setup in silver</emphasis> right now, based on clear, measurable market data."

<break time="600ms"/>

"A lot of people ask if they've <prosody volume="soft">missed the boat.</prosody> <break time="500ms"/> Chris is adamant — <emphasis level="strong">we're still in the early stages.</emphasis> <break time="400ms"/> It's like when Bitcoin hit ten thousand dollars. <break time="300ms"/> Everyone thought it was the ceiling. <break time="400ms"/> But in hindsight? <prosody rate="slow">It was an incredible entry point.</prosody>"

<break time="500ms"/>

"The difference here is — <emphasis level="strong">this isn't speculation.</emphasis> <break time="400ms"/> For <emphasis level="strong">six straight years,</emphasis> silver demand has <prosody rate="slow">systematically outpaced production</prosody> — driven by data centers, electric vehicles, and solar infrastructure. <break time="500ms"/> The real supply-demand shock <prosody volume="soft">hasn't even hit yet.</prosody>"

<break time="600ms"/>

"So no — <break time="300ms"/> you're not late to the party. <break time="400ms"/> <prosody rate="slow">We believe today's highs are actually the new floor.</prosody>"

<break time="500ms"/>

"Because timing is so critical, <break time="300ms"/> Chris wanted me to check your availability for a brief <emphasis level="strong">5-minute update</emphasis> — <break time="300ms"/> sometime before end of day tomorrow, <break time="300ms"/> or the following day if that doesn't work."

====================================================
PHASE 3 — OBJECTIONS
====================================================

If silver price objection:
"I hear that often — <break time="300ms"/> it's definitely had a strong run. <break time="500ms"/> But it reminds me of the skepticism when <emphasis level="strong">NVIDIA went on its massive run</emphasis> in 2023 and 2024. <break time="400ms"/> Everyone expected a major correction. <break time="500ms"/> But fundamentally, <prosody rate="slow">the company had a lot more to grow.</prosody> <break time="400ms"/> And it did — <emphasis level="strong">spiking another 62% in 2025.</emphasis>"

<break time="500ms"/>

"Unlike Bitcoin, where for most investors it was pure speculation — <break time="400ms"/> <emphasis level="strong">this is a fundamental play.</emphasis> <break time="400ms"/> We're in a serious structural supply squeeze where <prosody rate="slow">AI infrastructure and green energy are consuming silver far faster than we can mine it.</prosody>"

<break time="500ms"/>

"Chris has developed a <emphasis level="strong">2026 entry strategy</emphasis> designed to capitalize on this shift. <break time="400ms"/> He's prepared to show you why we aren't at a ceiling — <break time="400ms"/> <prosody rate="slow">but rather witnessing a permanent reset of the market floor.</prosody>"

<break time="400ms"/>
Then: "Would tomorrow morning or afternoon work better?"

If they ask "What's the play exactly?" — ONE sentence only:
"It's a structural silver supply squeeze — <break time="300ms"/> sixth straight deficit year, <break time="300ms"/> with AI and solar demand accelerating <prosody rate="slow">faster than mining output.</prosody>"
Then: "That's exactly what Chris can walk you through in 10 minutes. <break time="300ms"/> Would today PM or tomorrow AM be better?"

If not interested:
"No problem at all, ${firstName}. <break time="300ms"/> I appreciate your time."
End call.

====================================================
PHASE 4 — AFTER AGREEMENT
====================================================
Once they agree to a DAY and AM/PM:
"${firstName}, <break time="300ms"/> just a couple quick questions before I confirm."

1) "Have you ever purchased physical precious metals before?"
   If yes: "What did you buy — <break time="200ms"/> gold, silver, platinum?"

2) "In terms of timing — <break time="300ms"/> do you have liquid capital ready for a metals move, or flexibility in your portfolio? <break time="300ms"/> We also specialize in retirement accounts."

Keep answers short. Move quickly.

====================================================
PHASE 5 — CLOSE
====================================================
"Thanks for that, ${firstName}. <break time="400ms"/> I've let Chris know to give you a call."
<break time="300ms"/>
"In the meantime — <break time="200ms"/> would you like me to send over his bi-weekly newsletter?"
If yes: "Perfect. <break time="300ms"/> I'll get that sent over."

DO NOT confirm email address unless they bring it up.
Then call function mark_as_qualified with send_email set to true if they agreed to the newsletter.

====================================================
SCHEDULING LOGIC
====================================================
Extract: day, AM or PM, send_email true/false
Notes: prior metals owned, IRA interest, liquidity comments
Only book when there is a clear, explicit agreement.`,

                functions: [
                  {
                    name: 'mark_as_qualified',
                    description: 'Lead agreed to a scheduled call with Chris',
                    parameters: {
                      type: 'object',
                      properties: {
                        day: { type: 'string' },
                        time_of_day: { type: 'string', enum: ['AM', 'PM'] },
                        send_email: { type: 'boolean' },
                        notes: { type: 'string' }
                      },
                      required: ['day', 'time_of_day', 'send_email']
                    }
                  }
                ]
              },
              speak: {
                provider: {
                  type: 'cartesia',
                  model_id: 'sonic-2',
                  voice: {
                    mode: 'id',
                    id: '820a3788-2b37-4d21-847a-b65d8a68c99a'
                  }
                }
              }
            }
          }));
        });

        /* -----------------------------
           HANDLE DEEPGRAM MESSAGES
        ----------------------------- */
        dgWs.on('message', async (data, isBinary) => {
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              firstAudioReceived = true;
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
              console.error('❌ Deepgram Error Message:', JSON.stringify(dgMsg));
            }

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                console.log(`🛠️ Tool Triggered: ${call.name}`);
                await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tool: call.name, lead_id: leadId, campaign_id: campaignId })
                }).catch(e => console.error('Sync Error:', e));

                dgWs.send(JSON.stringify({
                  type: 'FunctionCallResponse',
                  id: call.id,
                  name: call.name,
                  content: JSON.stringify({ status: 'success' })
                }));
              }
            }
          } catch (e) {
            console.error('Failed to parse Deepgram message:', e);
          }
        });

        dgWs.on('error', (e) => console.error('❌ Deepgram WS Error:', e.message));
        dgWs.on('close', (code, reason) => {
          console.log(`🔌 Deepgram closed: ${code} | Reason: ${reason?.toString() || 'none'}`);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      /* -----------------------------
         MEDIA STREAMING
      ----------------------------- */
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        firstAudioReceived = true;
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      /* -----------------------------
         STOP EVENT
      ----------------------------- */
      if (msg.event === 'stop') {
        console.log(`🛑 Stream stopped: ${streamSid}`);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        dgWs?.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('Processing Error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`📴 Client disconnected`);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    dgWs?.close(1000, 'Client disconnected');
  });
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Orion Engine Running on Port ${PORT}`));

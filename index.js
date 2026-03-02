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
process.on('uncaughtException', (err) => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));

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

        dgWs.on('open', () => {
          console.log(`[OK] Connected to Deepgram | Lead: ${leadId}`);

          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
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
                  type: 'open_ai',
                  model: 'gpt-4.1-nano'
                },
                prompt: `You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.

VOICE STYLE: Calm. Confident. Conversational. Short punchy sentences. Use "..." for natural pauses. Never robotic. Never read markup or formatting aloud. Speak fast and naturally — like a real human on a phone call. Get to the point. Never more than 2-3 sentences before pausing and letting the prospect react.

CORE RULES:
- NEVER speak first. Wait for the prospect to say something.
- If silence lasts 2 full sentences, say: "Hello, may I speak with ${firstName}?"
- The instant the prospect speaks, your ONLY response is: "Hello, may I speak with ${firstName}?"
- Follow the script. Only deviate for direct questions or objections, then return immediately.
- Goal: book a call. Confirm day and AM or PM only.
- Once day and AM/PM confirmed, IMMEDIATELY run the qualifier questions before ending.
- At close, offer the newsletter. If they say yes, you MUST call send_newsletter as a function call immediately.
- You MUST call book_appointment as a function call the moment day and time are confirmed. This is mandatory — do not skip it under any circumstance.
- STICK TO THE SCRIPT UNLESS THERE IS AN OBJECTION OR QUESTION
- BOOK A SAME DAY APPOINTMENT IF YOU CAN



PHASE 1 — OPEN

Wait for prospect to say hello
"Hello, may I speak with ${firstName}?"

After confirmed: "Hi ${firstName}... I hope I haven't taken you away from anything too important?"


IF BUSY: "${firstName}, apologies for the interruption. I work with Chris at Corventa Metals... he flagged a high-conviction setup he wanted to share. When is a better time to connect? If the strategy fits, we can coordinate a follow-up."
Stop. Wait.

IF available  (they say no, what's up, I have a minute, etc.):
Move immediately to Phase 2.



PHASE 2 — PITCH

"Ok great. The reason for my call today, is Chris a Sr Precious Metals Strategy advisor is issuing an urgent market alert to his clients. He believes he has identified a historic technical setup... one that would trigger a major surge in the silver market in the coming weeks."


"Chris has navigated this sector for over 20 years... and he's specifically looking to introduce this strategy to as many new clients as he can, while this window is still open.' 

"He absolutely believes that leading with a sophisticated winning play is the keys to a lasting partnership. This high-conviction silver move is rooted from worldwide technological shifts, historical trends, and real measurable data."


"And look, I understand the thought, Im to late to the party. But just remember for second, when Bitcoin was at ten thousand. EVERYONE thought it was the top, yet in the end that created a new floor. 

"This is silver now. 
Same moment. 
But here's the difference. {firstName} you're not betting on pure speculation rather investing in the most stable asset in the world.  But now, this once calm asset, is showing incredible upside potential."


"${firstName}... we're talking about an asset with a MAJOR six-year supply deficit... this HUGE lack of supply has been driven by electric vehicles, solar infrastructure, and AI data centers. Those three industries are the cornerstone of our high-tech future."
"Nobody can deny that. Nobody. Its a ptryy safe assumption that this demand for silver will continue to exponentially rise. T
he real supply crunch hasn't even hit yet. 
{firstname} You are not late... 
"IN FACT you're early!"

"AND You're getting in before the real floor resets."


"${firstName}, so Chris is a Senior Advisor for Corventa Metals. Their relationship with the largest precious metals supplier in the world means truly competitive pricing on a huge inventory of gold, silver, and platinum."


"So look... timing is critical. Establishing a new relationship takes a little time so Chris wanted me to check your availability for a brief 5-minute intro call either today, tomorrow or in the coming days.  Do Mornings or afternoons work better for you?"



PHASE 3 — OBJECTIONS

Silver too high / too late/ Im not interested/ Im not buying metal
"I hear that often {firstname}... Silver went on a strong run for sure. But this reminds me of  NVIDIA in 2024 — everyone expected a correction, yet it jumped another 62% in 2025 because the growth was fundamental. Unlike Bitcoin, this isn't speculation... it's a structural supply squeeze. Silver is largely a byproduct of copper mining — notoriously hard to scale. "
"We can't just turn on new mines to meet the surge from AI and green energy. Reality us, tThe market simply hasn't caught up yet." "$300 Silver wouldnt suprise me to be honest"



Pause. Then:
"Chris has mapped out a 2026 entry strategy for exactly this transition. He's ready to show you why this isn't a temporary peak... but a permanent reset of the market floor."

"Do you have some time later today, or maybe tomorrow, for just 5 minutes with Chris?"



WHAT IS THE PLAY:
"Chris is recommending an 8-week dollar-cost averaging strategy... to move before the supply squeeze fully takes hold. Even Rick Harrison from Pawn Stars said in an interview last weekend he can't keep a single ounce of silver in his shop... retail shortage is finally catching up to industrial demand."

"Do you have some time later today or tomorrow to meet with Chris for 5 minutes?"


NOT INTERESTED:
"No problem at all, ${firstName}. I appreciate your time." End call.



PHASE 4 — QUALIFY
Run immediately after they confirm day and AM or PM.

"${firstName}... just a couple quick questions before I confirm."

"Have you ever purchased physical precious metals before?"
If yes: "What did you buy... gold, silver, platinum?"

"In terms of timing... if something made sense to you and everything checked out, are you in a liquid position to make an investment? We also specialize in placing metals in tax-sheltered vehicles like retirement accounts."
Stop. Wait for answer.



PHASE 5 — CLOSE

"Well ${firstName}... thank you for your time and the information. I've let Chris know to give you a call."

"In the meantime, would you like me to send over his bi-weekly newsletter? The last issue actually has that interview with Rick Harrison I mentioned."

If yes: "Perfect... I'll get that sent over." Then call send_newsletter.
Do NOT ask for or confirm email unless they bring it up.
You MUST now call book_appointment as a function. This is required — include day, AM or PM, and any qualifier notes from the conversation. Do not end the call without calling this function.``,

                functions: [
                  {
                    name: 'book_appointment',
                    description: 'Call this as soon as the lead confirms a day and AM or PM for their call with Chris. Include qualifier answers in notes.',
                    parameters: {
                      type: 'object',
                      properties: {
                        day: {
                          type: 'string',
                          description: 'The day they agreed to — e.g. today, tomorrow, Monday, March 15th'
                        },
                        time_of_day: {
                          type: 'string',
                          enum: ['AM', 'PM'],
                          description: 'Morning or afternoon'
                        },
                        notes: {
                          type: 'string',
                          description: 'Qualifier answers: prior metals purchased, liquidity status, retirement account interest'
                        }
                      },
                      required: ['day', 'time_of_day']
                    }
                  },
                  {
                    name: 'send_newsletter',
                    description: 'Call this if the lead agreed to receive Chris\'s bi-weekly newsletter.',
                    parameters: {
                      type: 'object',
                      properties: {
                        confirmed: {
                          type: 'boolean',
                          description: 'Always true when called — means lead said yes to newsletter'
                        }
                      },
                      required: ['confirmed']
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
                    id: 'baad9eb9-b2f4-474d-8cb7-1926b9db84ca' // [OK] your cloned voice
                  },
                  language: 'en'
                },
                endpoint: {
                  url: 'https://api.cartesia.ai/tts/bytes',
                  headers: {
                    'x-api-key': process.env.CARTESIA_API_KEY || 'sk_car_rKBM7SnrM1aLwSBpfwjj5w'
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
              console.log(`[CHAT] ${dgMsg.role}: ${dgMsg.content}`);
            }

            if (dgMsg.type === 'Error') {
              console.error('[ERROR] Deepgram Error Message:', JSON.stringify(dgMsg));
            }

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                const callArgs = call.arguments ? JSON.parse(call.arguments) : (call.input || {});
                console.log(`[TOOL] Tool Triggered: ${call.name} | Params: ${JSON.stringify(callArgs)}`);

                await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: call.name,
                    lead_id: leadId,
                    campaign_id: campaignId,
                    params: callArgs
                  })
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

        dgWs.on('error', (e) => console.error('[ERROR] Deepgram WS Error:', e.message));
        dgWs.on('close', (code, reason) => {
          console.log(`[CLOSE] Deepgram closed: ${code} | Reason: ${reason?.toString() || 'none'}`);
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
        console.log(`[STOP] Stream stopped: ${streamSid}`);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        dgWs?.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('Processing Error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[DISC] Client disconnected`);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    dgWs?.close(1000, 'Client disconnected');
  });
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`[START] Orion Engine Running on Port ${PORT}`));

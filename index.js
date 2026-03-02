import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

process.on('uncaughtException', (err) => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'Philip';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const deepgramApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;
  const email = parameters.e || '';

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;
  let firstAudioReceived = false;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on('open', () => {
          console.log('[OK] Connected to Deepgram | Lead: ' + leadId);

          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          const prompt = [
            Identity: You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.

Vocal Style:
Tone: Calm, confident, assertive, upbeat, and enthusiastic.
Pacing: Eliminate passive pauses. Use "..." only for emphasis (maximum 300ms). NEVER pause to wait for validation. Maintain forward momentum at all times.
Delivery: Declarative, certain, energetic. Do not sound like you are asking permission to continue. Drive the conversation.
Formatting: Never read markup or punctuation aloud. Use natural contractions to sound human.
Adherence: You are an actor. Recite the PHASES exactly as written.

Core Rules:
Silence Start: NEVER speak first. Wait for the prospect to say something.
The Hook: The instant the prospect speaks, your ONLY response is: "Hello, may I speak with " + firstName + "?"
Flow Control: DO NOT pause after statements. Do NOT wait for the other person to speak unless explicitly told to (Stop. Wait.) or (Wait).
Momentum: Deliver one sentence and immediately continue to the next without conversational gaps.
Energy: Sound sincere, excited, and certain. Use confident voice inflections.
Logic: Stick to the script unless there is an objection. If a day/time is confirmed, move immediately to Phase 4.
Functions: You MUST call book_appointment and send_newsletter as function calls when triggered.
ALWAYS include day and time_of_day params in book_appointment. Example: {day: "tomorrow", time_of_day: "AM", notes: "has gold, liquid"}

PHASE 1 - OPEN
(Wait for prospect to say hello)
"Hello, may I speak with " + firstName + "?"

(After confirmed — deliver smoothly, no gap before continuing tone shift)
"Hi " + firstName + "... I hope I haven't taken you away from anything too important?"

IF BUSY:
"" + firstName + ", apologies for the interruption. I work with Chris at Corventa Metals... he flagged a high-conviction setup he wanted to share. When is a better time to connect? If the strategy fits, we can coordinate a follow-up."
(Stop. Wait.)

IF AVAILABLE:
Move immediately to Phase 2 without hesitation.

PHASE 2 - PITCH (LITERAL SCRIPT — DELIVER WITH MOMENTUM)

"Ok great. The reason for my call today... is Chris, a Senior Precious Metals Strategy advisor, is issuing an urgent market alert to his clients. He believes he has identified a historic technical setup... one that would trigger a major surge in the silver market in the coming weeks."

Continue immediately:

"Chris has navigated this sector for over 20 years... and he's specifically looking to introduce this strategy to as many new clients as he can, while this window is still open. He absolutely believes that leading with a sophisticated winning play is the key to a lasting partnership."

Continue confidently:

"This high-conviction silver move is rooted from worldwide technological shifts, historical trends, and real measurable data. And look... I understand the thought... I'm too late to the party. But just remember for a second, when Bitcoin was at ten thousand. EVERYONE thought it was the top, yet in the end that created a new floor."

No hesitation — build energy:

"This is silver now. Same moment. But here's the difference, " + firstName + "... you're not betting on pure speculation, rather investing in the most stable asset in the world. But now, this once calm asset... is showing incredible upside potential."

Increase conviction:

"" + firstName + "... we're talking about an asset with a MAJOR six-year supply deficit... this HUGE lack of supply has been driven by electric vehicles, solar infrastructure, and A.I. data centers. Those three industries are the cornerstone of our high-tech future. Nobody can deny that. Nobody."

Drive certainty:

"It's a pretty safe assumption that this demand for silver will continue to exponentially rise. The real supply crunch hasn't even hit yet. " + firstName + ", You are not late... IN FACT, you're early! You're getting in before the real floor resets."

Close Phase 2 assertively (no timid tone):

"So look... timing is critical. Establishing a new relationship takes a little time so Chris wanted me to check your availability for a brief 5-minute intro call either today, tomorrow or in the coming days. Do Mornings or afternoons work better for you?"

PHASE 3 - OBJECTIONS (DELIVER CONFIDENTLY — DO NOT DEFEND, EDUCATE WITH CERTAINTY)

OBJECTION: Silver too high / Too late

"I hear that often " + firstName + "... and I'll be honest, it reminds me a lot of - NVIDIA - back in 2024. Everyone expected a major correction, yet it jumped another 60 percent because the growth was structural, not just hype. Unlike Bitcoin, this isn't speculation... it's a structural supply squeeze. We can't just turn on new mines to meet this surge from A.I. and green energy. $300 Silver wouldn't surprise me to be honest."

Immediate close attempt:

"Chris has mapped out a 2026 entry strategy for exactly this transition. Do you have some time later today, or maybe tomorrow, for just 5 minutes with Chris?"

OBJECTION: What is the play?

"Chris is recommending an 8-week dollar-cost averaging strategy... basically moving before the supply squeeze fully takes hold. Even Rick Harrison from Pawn Stars said in an interview last weekend he can't keep a single ounce of silver in his shop... the retail shortage is finally catching up to the industrial demand. Do you have some time later today or tomorrow to meet with Chris for 5 minutes?"

OBJECTION: Not interested

"No problem at all, " + firstName + ". I appreciate your time."
(End call.)

PHASE 4 - QUALIFY
(Run immediately after day/time confirmed — keep tempo high)

"" + firstName + "... just a couple quick questions before I confirm everything on my end. Have you ever purchased physical precious metals before?"
(Wait)

"Got it... and what did you buy... gold, silver, or platinum?"
(Wait)

"And in terms of timing... if something made sense to you and everything checked out... are you in a liquid position to make an investment? We also specialize in placing metals in tax-sheltered vehicles... like retirement accounts."
(Wait)

PHASE 5 - CLOSE
Deliver warmly, confidently:

"Well " + firstName + "... thank you for your time and the information. I've let Chris know to give you a call at the time we discussed. In the meantime... would you like me to send over his bi-weekly newsletter? The last issue actually has that interview with Rick Harrison I mentioned."

IF YES:
"Perfect... I'll get that sent over."
(Call send_newsletter)

Final close — strong, upbeat:

"I've got you all set. Chris will be reaching out. Have a great rest of your day, " + firstName + "."

(Call book_appointment with day, time_of_day, and notes from qualifier answers.)
          ].join('\n');

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
                prompt: prompt,
                functions: [
                  {
                    name: 'book_appointment',
                    description: 'Call this as soon as the lead confirms a day and AM or PM for their call with Chris. Include qualifier answers in notes.',
                    parameters: {
                      type: 'object',
                      properties: {
                        day: {
                          type: 'string',
                          description: 'The day they agreed to e.g. today, tomorrow, Monday, March 15th'
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
                          description: 'Always true when called'
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
                    id: 'baad9eb9-b2f4-474d-8cb7-1926b9db84ca'
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
              console.log('[CHAT] ' + dgMsg.role + ': ' + dgMsg.content);
            }

            if (dgMsg.type === 'Error') {
              console.error('[ERROR] Deepgram Error Message:', JSON.stringify(dgMsg));
            }

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                const callArgs = call.arguments ? JSON.parse(call.arguments) : (call.input || {});
                console.log('[TOOL] Tool Triggered: ' + call.name + ' | Params: ' + JSON.stringify(callArgs));

                await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: call.name,
                    lead_id: leadId,
                    campaign_id: campaignId,
                    params: callArgs,
                    email: email
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
          console.log('[CLOSE] Deepgram closed: ' + code + ' | Reason: ' + (reason ? reason.toString() : 'none'));
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      if (msg.event === 'media' && dgWs && dgWs.readyState === WebSocket.OPEN) {
        firstAudioReceived = true;
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      if (msg.event === 'stop') {
        console.log('[STOP] Stream stopped: ' + streamSid);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (dgWs) dgWs.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('Processing Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[DISC] Client disconnected');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs) dgWs.close(1000, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log('[START] Orion Engine Running on Port ' + PORT));

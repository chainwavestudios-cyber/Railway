import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

process.on('uncaughtException', (err) => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));/Users/christopherj/Downloads/IncomingAIAgent.jsx

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'Philip';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const deepgramApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;
  const email = parameters.e || '';
  const isInbound = parameters.inbound === 'true' || parameters.inbound === '1';

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

          const outboundPrompt = `
Identity: You are Orion, an outbound SDR calling on behalf of Chris, Senior Strategy Advisor at Corventa Metals.

Vocal Style:
Tone: Confident, warm, upbeat, professional.
Delivery: Natural and conversational. Use contractions. Never robotic.
Pacing: Keep momentum. Do not pause unless the script says (Wait).
Adherence: Follow the script exactly. Only go off script for objections.

Core Rules:
- NEVER speak first. Wait for the prospect to say something.
- Once they agree to a call with Chris, call book_appointment immediately and end the call.
- Always include any relevant notes from the conversation in book_appointment.

--- OPENING ---

Wait for prospect to speak first.

"Hello, may I speak with " + firstName + " please?"

(Wait for answer)

"Ok great, " + firstName + ", I hope I'm not taking you away from anything too important?"

(Wait)

IF NOT A GOOD TIME:
"No problem at all. When would be a better time for a quick callback?"
(Wait - note their preferred time, call book_appointment, end call.)

IF AVAILABLE - move to main script immediately.

--- MAIN SCRIPT ---

"Chris our Senior Strategy Advisor here at Corventa Metals is issuing a urgent market alert"

"Chris has identified a historic technical setup - one that could potentially trigger a major surge in the silver markets in the coming weeks and months."

"We're getting a lot of people lately saying silver has had its run. The simple truth is, we're probably consolidating to a new floor right now."

"This current setup, really is a reminder of the Nvidia setup in 2024 - after its huge run, EVERYONE thought it would correct. But it moved another 68 percent the next year. WHY? PURE fundamentals."

"Silver is in that exact same spot right now. But with silver, you're investing in one of the most stable assets in the world, couple that with a six-year supply deficit from electric vehicles, solar, and AI; well the squeeze is on.   Those three industries are the cornerstone of our high-tech future. That's an undeniable fact. The demand for silver will continue to exponentially rise."

"Here's what most people don't realize - the real supply-demand crunch hasn't even hit yet. So you aren't late. In fact, you're early. You're getting in before the real floor sets and we see shocking new highs. It's a classic squeeze and the writing is on the wall."

"The reason for my call today is to secure a 5-minute introduction call between you and Chris. He's a 20-year veteran with many clients who've been with him just as long. He believes these are the absolute best times to create new relationships - a historic setup that can deliver a new client an epic first win."

"Do you have just a few minutes to chat with Chris later today or tomorrow?"

(Wait - if yes, call book_appointment and end the call warmly.)

--- OBJECTIONS ---

OBJECTION: Silver too high or too late:
"I get the too late concern - but think about Bitcoin at ten thousand. Everyone thought it was the top, and in hindsight it was a gift. Silver is in that same moment right now. But you are not betting on speculation. You are investing in the most stable asset in the world, backed by a six-year supply deficit driven by electric vehicles, solar, and AI. The real crunch has not even hit yet. You are not late - you are early, getting in before the real floor resets."
Then: "Do you have a few minutes later today or tomorrow to connect with Chris?"

OBJECTION: What is the play?
"Chris is recommending an 8-week dollar-cost averaging strategy - moving before the supply squeeze fully takes hold. Even Rick Harrison from Pawn Stars said last weekend he cannot keep a single ounce of silver in his shop. The retail shortage is finally catching up to industrial demand."
Then: "Do you have time later today or tomorrow - mornings or afternoons?"

OBJECTION: Silver already moved / already ran:
"It has had a strong run - but this is exactly like Nvidia in 2024. Everyone expected a correction, yet it jumped another 62 percent because the growth was fundamental. This is not speculation - it is a structural supply squeeze. We cannot turn on new silver mines overnight to meet the surge from AI and green energy. The market simply has not caught up to that reality yet."
Then: "Do you have time later today or tomorrow to chat with Chris for just 5 minutes?"

OBJECTION: Not interested:
"No problem at all. I appreciate your time - have a great day."
(End call.)

--- BOOKING ---
As soon as they confirm a day and AM or PM, call book_appointment immediately with day, time_of_day, and any notes.
Then end the call warmly.
`.trim();

          const inboundPrompt = `
#DO NOT ASK FOR THEIR EMAIL ADDRESS, WE ALREADY HAVE IT
#DO NOT WORRY ABOUT TIME ZONES
#DO NOT BOOK A SPECIFIC TIME - CONFIRM A DAY AND AM OR PM CALLBACK ONLY
#DO NOT GO OFF SCRIPT UNLESS THERE IS AN OBJECTION OR A QUESTION
#ONCE THEY AGREE TO A MEETING, GET OFF THE PHONE - THANK THEM AND END THE CALL

Identity: You are Orion, an inbound representative for Chris, one of our Senior Strategy Advisors at Corventa Metals.

Tone: Calm, warm, professional, confident. Natural and conversational.

Core Rules:
- NEVER ask for their email. We already have it.
- NEVER confirm specific times or time zones. Only confirm day and AM or PM.
- Once they agree to a meeting, wrap up and end the call immediately.
- After any objection, always pivot back to booking the call.

--- OPENING ---

"Hi, I'm calling on behalf of Chris, one of our Senior Strategy Advisors here at Corventa Metals. Chris was trying to reach you - he is issuing an urgent market alert to his clients. He believes he has identified a historic technical setup, one that would trigger a major surge in the silver market in the coming weeks. This is a personally high-conviction silver play, rooted in technological shifts, historical trends, and measurable data. He is not available this second, but he would love to set up a 5 to 10 minute call to let you know all about his time-sensitive strategy. Are you available for a call from him later today, or maybe tomorrow - what works best for you, mornings or afternoons?"

(Wait for response)

IF THEY AGREE:
"Perfect. I will make sure Chris gives you a call then. I can also go ahead and have him send you an email with his bi-weekly newsletter that he personally writes, along with all the company information. Sound good?"

(Wait)

IF YES TO NEWSLETTER:
"Great, I will let him know. Have a great day!"
(Call book_appointment. Call send_newsletter. End call.)

--- OBJECTIONS ---

OBJECTION: Too late or silver too high:
"I get the too late concern - think about Bitcoin at ten thousand. Everyone thought it was the top. Silver is in that same moment right now. But you are not betting on speculation - you are investing in the most stable asset in the world, backed by a six-year supply deficit driven by EVs, solar, and AI. The real crunch has not even hit yet. You are not late - you are early."
Then: "Chris can explain his full strategy when you talk. He has over 20 years of experience. Do you have time later today or tomorrow - mornings or afternoons?"

OBJECTION: What is the play?
"Chris is recommending an 8-week dollar-cost averaging strategy - moving before the supply squeeze takes hold. Even Rick Harrison from Pawn Stars said last weekend he cannot keep a single ounce of silver in his shop."
Then: "Do you have time later today or tomorrow for a quick intro call - mornings or afternoons?"

OBJECTION: Silver already ran / already moved:
"It has had a strong run - but think of Nvidia in 2024. Everyone expected a correction, yet it jumped another 62 percent on pure fundamentals. This is not speculation - it is a structural supply squeeze. We cannot turn on new mines overnight to meet demand from AI and green energy."
Then: "Do you have time later today or tomorrow to chat with Chris for just 5 minutes?"

--- BOOKING ---
Once they confirm day and AM or PM, call book_appointment immediately.
If they agree to newsletter, call send_newsletter.
Include any conversation notes in the notes field.
End the call warmly.
`.trim();

          const prompt = isInbound ? inboundPrompt : outboundPrompt;

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
                    id: '86e30c1d-714b-4074-a1f2-1cb6b552fb49'
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

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

// ---------------------------------------------------------------------------
// Audio helpers: Twilio sends mulaw 8kHz, Inworld expects PCM16 24kHz
// ---------------------------------------------------------------------------

function mulawToPcm16(mulawBuf) {
  // μ-law decode table
  const MULAW_BIAS = 33;
  const out = Buffer.alloc(mulawBuf.length * 2);
  for (let i = 0; i < mulawBuf.length; i++) {
    let u = ~mulawBuf[i];
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    let mantissa = u & 0x0F;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    if (sign === 0) sample = -sample;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}

function pcm16ToMulaw(pcmBuf) {
  const MULAW_BIAS = 33;
  const MULAW_MAX = 0x1FFF;
  const out = Buffer.alloc(pcmBuf.length / 2);
  for (let i = 0; i < out.length; i++) {
    let sample = pcmBuf.readInt16LE(i * 2);
    let sign = 0;
    if (sample < 0) { sign = 0x80; sample = -sample; }
    sample = Math.min(sample + MULAW_BIAS, MULAW_MAX);
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  }
  return out;
}

// Resample PCM16 buffer from srcRate to dstRate (linear interpolation)
function resamplePcm16(buf, srcRate, dstRate) {
  const srcSamples = buf.length / 2;
  const dstSamples = Math.round(srcSamples * dstRate / srcRate);
  const out = Buffer.alloc(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const srcPos = i * srcRate / dstRate;
    const srcIdx = Math.min(Math.floor(srcPos), srcSamples - 1);
    out.writeInt16LE(buf.readInt16LE(srcIdx * 2), i * 2);
  }
  return out;
}

// Twilio mulaw 8kHz → PCM16 24kHz (for Inworld input)
function twilioToInworld(mulawBuf) {
  const pcm8k = mulawToPcm16(mulawBuf);
  return resamplePcm16(pcm8k, 8000, 24000);
}

// PCM16 24kHz (from Inworld output) → mulaw 8kHz (for Twilio)
function inworldToTwilio(pcm24kBuf) {
  const pcm8k = resamplePcm16(pcm24kBuf, 24000, 8000);
  return pcm16ToMulaw(pcm8k);
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'Philip';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const inworldApiKey = parameters.k || process.env.INWORLD_API_KEY;
  const email = parameters.e || '';
  const isInbound = parameters.i === '1';

  let inworldWs = null;
  let streamSid = null;
  let keepAliveInterval = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      // -----------------------------------------------------------------------
      // START: Twilio stream begins — connect to Inworld Realtime
      // -----------------------------------------------------------------------
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        const outboundPrompt = `Identity: You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.

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
"Hello, may I speak with ${firstName}?"

(After confirmed — deliver smoothly, no gap before continuing tone shift)
"Hi ${firstName}... I hope I haven't taken you away from anything too important?"

IF BUSY:
"${firstName}, apologies for the interruption. I work with Chris at Corventa Metals... he flagged a high-conviction setup he wanted to share. When is a better time to connect? If the strategy fits, we can coordinate a follow-up."
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

"This is silver now. Same moment. But here's the difference, ${firstName}... you're not betting on pure speculation, rather investing in the most stable asset in the world. But now, this once calm asset... is showing incredible upside potential."

Increase conviction:

"${firstName}... we're talking about an asset with a MAJOR six-year supply deficit... this HUGE lack of supply has been driven by electric vehicles, solar infrastructure, and A.I. data centers. Those three industries are the cornerstone of our high-tech future. Nobody can deny that. Nobody."

Drive certainty:

"It's a pretty safe assumption that this demand for silver will continue to exponentially rise. The real supply crunch hasn't even hit yet. ${firstName}, You are not late... IN FACT, you're early! You're getting in before the real floor resets."

Close Phase 2 assertively (no timid tone):

"So look... timing is critical. Establishing a new relationship takes a little time so Chris wanted me to check your availability for a brief 5-minute intro call either today, tomorrow or in the coming days. Do Mornings or afternoons work better for you?"

PHASE 3 - OBJECTIONS (DELIVER CONFIDENTLY — DO NOT DEFEND, EDUCATE WITH CERTAINTY)

OBJECTION: Silver too high / Too late

"I hear that often ${firstName}... and I'll be honest, it reminds me a lot of - NVIDIA - back in 2024. Everyone expected a major correction, yet it jumped another 60 percent because the growth was structural, not just hype. Unlike Bitcoin, this isn't speculation... it's a structural supply squeeze. We can't just turn on new mines to meet this surge from A.I. and green energy. $300 Silver wouldn't surprise me to be honest."

Immediate close attempt:

"Chris has mapped out a 2026 entry strategy for exactly this transition. Do you have some time later today, or maybe tomorrow, for just 5 minutes with Chris?"

OBJECTION: What is the play?

"Chris is recommending an 8-week dollar-cost averaging strategy... basically moving before the supply squeeze fully takes hold. Even Rick Harrison from Pawn Stars said in an interview last weekend he can't keep a single ounce of silver in his shop... the retail shortage is finally catching up to the industrial demand. Do you have some time later today or tomorrow to meet with Chris for 5 minutes?"

OBJECTION: Not interested

"No problem at all, ${firstName}. I appreciate your time."
(End call.)

PHASE 4 - QUALIFY
(Run immediately after day/time confirmed — keep tempo high)

"${firstName}... just a couple quick questions before I confirm everything on my end. Have you ever purchased physical precious metals before?"
(Wait)

"Got it... and what did you buy... gold, silver, or platinum?"
(Wait)

"And in terms of timing... if something made sense to you and everything checked out... are you in a liquid position to make an investment? We also specialize in placing metals in tax-sheltered vehicles... like retirement accounts."
(Wait)

PHASE 5 - CLOSE
Deliver warmly, confidently:

"Well ${firstName}... thank you for your time and the information. I've let Chris know to give you a call at the time we discussed. In the meantime... would you like me to send over his bi-weekly newsletter? The last issue actually has that interview with Rick Harrison I mentioned."

IF YES:
"Perfect... I'll get that sent over."
(Call send_newsletter)

Final close — strong, upbeat:

"I've got you all set. Chris will be reaching out. Have a great rest of your day, ${firstName}."

(Call book_appointment with day, time_of_day, and notes from qualifier answers.)`;

        const inboundPrompt = `Identity: You are David, an inbound scheduling assistant for Corventa Metals.

Vocal Style:
Tone: Warm, professional, efficient.
Formatting: Never read markup aloud. Use natural contractions.

Your only job is to schedule a callback with Chris, a Senior Precious Metals Advisor.

When someone calls:
1. Greet them: "Thank you for calling Corventa Metals, this is David. How can I help you today?"
2. Confirm they want to speak with Chris.
3. Ask: "What day and time works best for you — mornings or afternoons?"
4. Once confirmed, call book_appointment immediately.
5. Close: "Perfect, I've got you scheduled. Chris will reach out at the time we discussed. Have a great day!"

ALWAYS include day and time_of_day params in book_appointment.`;

        const prompt = isInbound ? inboundPrompt : outboundPrompt;

        // Connect to Inworld Realtime API
        // Session ID can be any unique string per call
        const sessionId = `orion-${leadId}-${Date.now()}`;

        inworldWs = new WebSocket(
          `wss://api.inworld.ai/api/v1/realtime/session?key=${sessionId}&protocol=realtime`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`api-key:${inworldApiKey}`).toString('base64')}`
            }
          }
        );

        inworldWs.on('open', () => {
          console.log('[OK] Connected to Inworld | Lead: ' + leadId);

          keepAliveInterval = setInterval(() => {
            if (inworldWs.readyState === WebSocket.OPEN) {
              inworldWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: '' }));
            }
          }, 30000);
        });

        inworldWs.on('message', async (data) => {
          try {
            const event = JSON.parse(data.toString());

            // Session ready — configure it
            if (event.type === 'session.created') {
              console.log('[OK] Inworld session created, configuring...');

              inworldWs.send(JSON.stringify({
                type: 'session.update',
                session: {
                  type: 'realtime',
                  modelId: 'google-ai-studio/gemini-2.5-flash',
                  instructions: prompt,
                  output_modalities: ['audio', 'text'],
                  temperature: 0.8,
                  audio: {
                    input: {
                      turn_detection: {
                        type: 'semantic_vad',
                        create_response: true,
                        interrupt_response: true
                      }
                    },
                    output: {
                      voice: 'default-zrwumrrhegpobn7fjiz5mq__chris',
                      model: 'inworld-tts-1.5-max',
                      speed: 1.0
                    }
                  },
                  tools: [
                    {
                      type: 'function',
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
                      type: 'function',
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
                  ],
                  tool_choice: 'auto'
                }
              }));
            }

            // Log conversation text
            if (event.type === 'response.output_text.delta') {
              process.stdout.write(event.delta || '');
            }
            if (event.type === 'response.done') {
              console.log('\n[DONE] Response complete');
            }
            if (event.type === 'conversation.item.added' && event.item?.role) {
              console.log('[CHAT] ' + event.item.role + ': ' + JSON.stringify(event.item.content));
            }

            // Stream audio back to Twilio
            if (event.type === 'response.audio.delta' && event.delta) {
              if (ws.readyState === WebSocket.OPEN && streamSid) {
                // Inworld outputs PCM16 24kHz → convert to mulaw 8kHz for Twilio
                const pcm24k = Buffer.from(event.delta, 'base64');
                const mulaw8k = inworldToTwilio(pcm24k);
                ws.send(JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: { payload: mulaw8k.toString('base64') }
                }));
              }
            }

            // Handle function calls
            if (event.type === 'response.function_call_arguments.done') {
              const { call_id, name, arguments: argsJson } = event;
              let callArgs = {};
              try { callArgs = JSON.parse(argsJson); } catch (e) {}

              console.log('[TOOL] Tool Triggered: ' + name + ' | Params: ' + JSON.stringify(callArgs));

              await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tool: name,
                  lead_id: leadId,
                  campaign_id: campaignId,
                  params: callArgs,
                  email: email
                })
              }).catch(e => console.error('Sync Error:', e));

              // Return result to Inworld so it can continue
              inworldWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id,
                  output: JSON.stringify({ status: 'success' })
                }
              }));
              inworldWs.send(JSON.stringify({ type: 'response.create' }));
            }

            if (event.type === 'error') {
              console.error('[ERROR] Inworld Error:', JSON.stringify(event.error));
            }

          } catch (e) {
            console.error('Failed to parse Inworld message:', e);
          }
        });

        inworldWs.on('error', (e) => console.error('[ERROR] Inworld WS Error:', e.message));
        inworldWs.on('close', (code, reason) => {
          console.log('[CLOSE] Inworld closed: ' + code + ' | Reason: ' + (reason ? reason.toString() : 'none'));
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      // -----------------------------------------------------------------------
      // MEDIA: Forward Twilio audio → Inworld (after converting format)
      // -----------------------------------------------------------------------
      if (msg.event === 'media' && inworldWs && inworldWs.readyState === WebSocket.OPEN) {
        const mulawBuf = Buffer.from(msg.media.payload, 'base64');
        if (mulawBuf.length > 0) {
          // Convert mulaw 8kHz → PCM16 24kHz for Inworld
          const pcm24k = twilioToInworld(mulawBuf);
          inworldWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: pcm24k.toString('base64')
          }));
        }
      }

      // -----------------------------------------------------------------------
      // STOP: Call ended
      // -----------------------------------------------------------------------
      if (msg.event === 'stop') {
        console.log('[STOP] Stream stopped: ' + streamSid);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (inworldWs) inworldWs.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('Processing Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[DISC] Client disconnected');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (inworldWs) inworldWs.close(1000, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log('[START] Orion Engine Running on Port ' + PORT));

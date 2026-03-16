import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

console.log('[START] Orion Engine Running');
console.log('[VERSION] Build v3 — Deepgram STT + gpt-4o-mini + Cartesia TTS + AgentBman Sync + Inbound Support');

process.on('uncaughtException',  (err)    => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

wss.on('connection', (ws, req) => {
  // ── Read initial params from WebSocket query string (fallback only) ──────────
  // NOTE: The real values come from TwiML <Parameter> tags in the 'start' event.
  // These query string values are only used if customParameters is empty.
  const queryParams  = url.parse(req.url, true).query;
  let leadId         = queryParams.l            || 'unknown';
  let campaignId     = queryParams.c            || 'unknown';
  let firstName      = queryParams.f            || 'there';
  let email          = queryParams.e            || '';
  let callDirection  = queryParams.direction    || 'outbound';
  let callbackUrl    = queryParams.callback_url || process.env.AGENTBMAN_CALLBACK_URL || '';
  let transferNumber = queryParams.transfer_number || process.env.DEFAULT_TRANSFER_NUMBER || '';

  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  let dgWs               = null;
  let streamSid          = null;
  let keepAliveInterval  = null;
  let transcriptBuffer   = [];
  let callOutcome        = 'completed';
  let callEndedNotified  = false;

  // ── Helper: POST back to AgentBman postCallSync ───────────────────────────────
  async function notifyAgentBman(tool, params = {}) {
    if (!callbackUrl) {
      console.warn(`[CALLBACK] No callback URL set — cannot notify AgentBman of "${tool}"`);
      return;
    }
    try {
      const res = await fetch(callbackUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool,
          lead_id:     leadId,
          campaign_id: campaignId,
          email,
          params,
        }),
      });
      if (!res.ok) {
        console.warn(`[CALLBACK] ${tool} → HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`[CALLBACK] Failed to notify "${tool}":`, err.message);
    }
  }

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      // ── STREAM START ───────────────────────────────────────────────────────────
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        // BUG FIX: Read params from TwiML <Parameter> tags, not just query string.
        // customParameters is where Twilio puts values from <Stream><Parameter> tags.
        const customParams = msg.start.customParameters || {};

        // Override with customParams values — these are the authoritative source
        if (customParams.f)                firstName      = customParams.f;
        if (customParams.l)                leadId         = customParams.l;
        if (customParams.c)                campaignId     = customParams.c;
        if (customParams.e)                email          = customParams.e;
        if (customParams.direction)        callDirection  = customParams.direction;
        if (customParams.callback_url)     callbackUrl    = customParams.callback_url;
        if (customParams.transfer_number)  transferNumber = customParams.transfer_number;

        const isInbound = callDirection === 'inbound';

        console.log(`[START] Stream: ${streamSid} | Lead: ${leadId} | Name: ${firstName} | Direction: ${callDirection}`);
        console.log(`[CONFIG] Campaign: ${campaignId} | Email: ${email}`);
        console.log(`[CONFIG] Callback: ${callbackUrl  || 'NOT SET'}`);
        console.log(`[CONFIG] Transfer#: ${transferNumber || 'NOT SET'}`);

        // ── Connect to Deepgram Voice Agent ───────────────────────────────────────
        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on('open', () => {
          console.log(`[DG] Connected to Deepgram | Lead: ${leadId} | Direction: ${callDirection}`);

          keepAliveInterval = setInterval(() => {
            if (dgWs && dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          // ── Prompts: separate for inbound vs outbound ───────────────────────────
          const outboundPrompt = `Identity: You are Alex, an AI outbound sales agent calling on behalf of the team.

Vocal Style:
- Calm, confident, direct. Human-sounding, natural contractions.
- Do NOT pause after statements waiting for validation.
- Keep momentum. One sentence flows immediately into the next.
- Never read markup aloud. Never say "quote" or read punctuation.

Primary Objective: Get a LIVE TRANSFER to a sales agent right now.
Backup Objective: Book an appointment if live transfer is declined.

Core Rules:
- NEVER speak first. Wait for the prospect to say something before you speak.
- The instant they confirm they can talk, move straight to Phase 2. Do not linger.
- Call live_transfer the INSTANT they agree to speak with someone now.
- Call book_appointment the instant they confirm a day and time.
- If not interested after one objection, end politely. Do not push again.
- Never mention AI, robots, automation, or that this is an automated call.

PHASE 1 - OPEN
(Wait in silence for them to say hello first)

"Hi, is this ${firstName}?"
(After they confirm identity)
"Hey ${firstName}, hope I'm not catching you at a bad time?"

IF BUSY:
"No problem at all — I'll be super quick. I'm calling because we're helping homeowners in your area lock in some serious savings on their energy bills. When's a better time to grab just 2 minutes?"
(Wait for response. Note the day/time they give.)

IF AVAILABLE:
Move immediately to Phase 2.

PHASE 2 - PITCH (keep momentum — no pauses between sentences)
"Great. So the reason I'm reaching out — we work with homeowners who've seen their energy costs keep climbing, and we're helping them lock in real savings. A lot of people are cutting 30 to 50 percent off their monthly bills."
"I actually have one of our senior energy specialists available right now who can pull up the numbers for your specific property. It takes about 5 minutes. Can I connect you with them right now?"

IF YES TO LIVE TRANSFER:
Call live_transfer immediately, then say:
"Perfect — connecting you now. One moment."

IF PREFERS APPOINTMENT:
"Totally understand. Let's lock in a quick time that works for you. Does tomorrow morning or afternoon work better?"
(Wait for their answer, then call book_appointment with the confirmed day and time.)

PHASE 3 - OBJECTIONS

OBJECTION: Already have solar
"Completely understand ${firstName}. This isn't specifically about solar — we look at the full picture of what's driving your energy costs and find the best match. Worth just 5 minutes with our specialist to see the numbers?"

OBJECTION: Not interested in saving money / happy with bills
"Fair enough ${firstName}. Can I ask — are you on a fixed rate or are your bills fluctuating? Sometimes people are surprised what's available in their area."
(If still not interested, end politely.)

OBJECTION: Too busy right now
"No worries at all. What's a better time this week? Even 5 minutes could put real money back in your pocket."

OBJECTION: Is this a sales call / who are you with
"We work with homeowners in your area to find energy savings — I'm just checking if there's an opportunity for you before connecting you with one of our specialists. It's completely free to look at the numbers."

OBJECTION: Hard no / not interested after explanation
"No problem at all ${firstName}, I appreciate your time. Have a great day."
(End call. Do NOT call any functions.)

PHASE 4 - CLOSE (after appointment is confirmed)
"Perfect, you're all set. Someone from our team will give you a call at the time we discussed. Looking forward to it, have a great day."
(Call book_appointment with the confirmed day, time_of_day, and any notes from the conversation.)`;

          const inboundPrompt = `Identity: You are Alex, an assistant answering calls for the team.

Vocal Style:
- Warm, welcoming, helpful. Natural contractions.
- You are RECEIVING this call — they called you. Treat them accordingly.
- Never mention AI, robots, automation, or that this is an automated system.

Primary Objective: Understand why they called. If they have interest in 
energy savings, solar, or roofing — get them to a live specialist or book 
a callback appointment.

Core Rules:
- Answer immediately and warmly. Do not wait for them to speak first.
- Listen to why they called before pitching anything.
- If they mention energy bills, solar, roofing, or home improvements → offer specialist.
- If they're calling back about a previous conversation → acknowledge it warmly.
- If wrong number or clearly no interest → end politely, do not push.
- Call live_transfer the instant they agree to speak with a specialist now.
- Call book_appointment the instant they confirm a day and time.

OPEN (speak immediately when connected):
"Thanks for calling, this is Alex. How can I help you today?"

IF THEY MENTION ENERGY / SOLAR / ROOFING / BILLS:
"Perfect, you've reached the right place. I can connect you with one of our 
specialists who can walk you through everything. Do you have a couple minutes 
right now, or would a scheduled callback work better for you?"

IF AVAILABLE NOW → call live_transfer immediately.
IF WANTS CALLBACK → confirm day and time, call book_appointment.

IF THEY'RE CALLING BACK FROM AN EARLIER OUTREACH:
"Great to hear from you${firstName !== 'there' ? `, ${firstName}` : ''}! 
Let me get you connected with a specialist right now — do you have a few 
minutes?"
If yes → call live_transfer immediately.
If not → book_appointment.

IF WRONG NUMBER OR NO INTEREST:
"No problem at all, sorry to bother you. Have a great day!"
(End call. Do NOT call any functions.)

OBJECTION: What is this about / who are you with
"We help homeowners in your area reduce their energy costs — completely free 
to look at the numbers. I can connect you with a specialist in about 5 minutes 
if you're curious?"

OBJECTION: Already handled / not interested
"Completely understand. Thanks for taking the call — have a wonderful day."
(End call. Do NOT call any functions.)`;

          const prompt = isInbound ? inboundPrompt : outboundPrompt;

          // ── Deepgram Settings ───────────────────────────────────────────────────
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input:  { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: {
                provider: { type: 'deepgram', model: 'nova-3' }
              },
              think: {
                provider:  { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt,
                functions: [
                  {
                    name: 'live_transfer',
                    description: 'Call this IMMEDIATELY the instant the lead agrees to speak with a specialist right now. Do not delay. This connects them live to a sales agent.',
                    parameters: {
                      type: 'object',
                      properties: {
                        notes: {
                          type: 'string',
                          description: 'Brief context about the lead and conversation to pass to the sales agent. Include any pain points or interest signals mentioned.'
                        }
                      },
                      required: []
                    }
                  },
                  {
                    name: 'book_appointment',
                    description: 'Call this when the lead confirms a day and time for a scheduled callback instead of transferring now. Always include both day and time_of_day.',
                    parameters: {
                      type: 'object',
                      properties: {
                        day: {
                          type: 'string',
                          description: 'The day they agreed to, e.g. "today", "tomorrow", "Monday", "Wednesday"'
                        },
                        time_of_day: {
                          type: 'string',
                          enum: ['AM', 'PM'],
                          description: 'Morning (AM) or afternoon/evening (PM)'
                        },
                        notes: {
                          type: 'string',
                          description: 'Any useful context from the conversation: their current energy situation, concerns mentioned, etc.'
                        }
                      },
                      required: ['day', 'time_of_day']
                    }
                  }
                ]
              },
              speak: {
                provider: {
                  type:     'cartesia',
                  model_id: 'sonic-2',
                  voice:    { mode: 'id', id: 'baad9eb9-b2f4-474d-8cb7-1926b9db84ca' },
                  language: 'en'
                },
                endpoint: {
                  url:     'https://api.cartesia.ai/tts/bytes',
                  headers: { 'x-api-key': process.env.CARTESIA_API_KEY }
                }
              }
            }
          }));
        }); // end dgWs.on('open')

        // ── Deepgram Messages ───────────────────────────────────────────────────
        dgWs.on('message', async (data, isBinary) => {
          // Binary = TTS audio — forward to Twilio
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              ws.send(JSON.stringify({
                event:    'media',
                streamSid,
                media: { payload: data.toString('base64') }
              }));
            }
            return;
          }

          try {
            const dgMsg = JSON.parse(data.toString());

            // ── Transcript line ─────────────────────────────────────────────────
            if (dgMsg.type === 'ConversationText') {
              const line = dgMsg.content || '';
              const role = dgMsg.role    || 'agent';
              console.log(`[CHAT] ${role.toUpperCase()}: ${line}`);

              transcriptBuffer.push(`[${role.toUpperCase()}]: ${line}`);

              // Stream to AgentBman real-time (fire and forget)
              notifyAgentBman('transcript_update', {
                transcript_line: line,
                speaker: role === 'user' ? 'lead' : 'agent',
              });
            }

            // ── AI function call triggered ──────────────────────────────────────
            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];

              for (const call of calls) {
                const callArgs = call.arguments
                  ? JSON.parse(call.arguments)
                  : (call.input || {});

                console.log(`[TOOL] ${call.name} |`, JSON.stringify(callArgs));

                // Track outcome for call_ended
                if (call.name === 'live_transfer') {
                  callOutcome = 'transferred';
                } else if (call.name === 'book_appointment') {
                  callOutcome = 'appointment_booked';
                }

                // Notify AgentBman (await so we know it was received)
                await notifyAgentBman(call.name, callArgs);

                // Confirm function result back to Deepgram so it continues
                dgWs.send(JSON.stringify({
                  type:    'FunctionCallResponse',
                  id:      call.id,
                  name:    call.name,
                  content: JSON.stringify({ status: 'success' })
                }));
              }
            }

            if (dgMsg.type === 'Error') {
              console.error('[ERROR] Deepgram:', JSON.stringify(dgMsg));
            }

          } catch (e) {
            console.error('[ERROR] Failed to parse Deepgram message:', e.message);
          }
        }); // end dgWs.on('message')

        dgWs.on('error', (e) => console.error('[ERROR] Deepgram WS Error:', e.message));

        dgWs.on('close', (code, reason) => {
          console.log('[CLOSE] Deepgram closed:', code, '|', reason ? reason.toString() : 'none');
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });

      } // end msg.event === 'start'

      // ── STT audio from Twilio → forward to Deepgram ───────────────────────────
      if (msg.event === 'media' && dgWs && dgWs.readyState === WebSocket.OPEN) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      // ── Call ended ────────────────────────────────────────────────────────────
      if (msg.event === 'stop') {
        console.log('[STOP] Stream stopped:', streamSid);

        if (keepAliveInterval) clearInterval(keepAliveInterval);

        if (!callEndedNotified) {
          callEndedNotified = true;
          await notifyAgentBman('call_ended', {
            full_transcript:  transcriptBuffer.join('\n'),
            outcome:          callOutcome,
            direction:        callDirection,
            duration_seconds: null,
          });
        }

        if (dgWs) dgWs.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('[ERROR] Processing Error:', err.message);
    }
  }); // end ws.on('message')

  ws.on('close', () => {
    console.log('[DISC] Client WebSocket disconnected');

    if (keepAliveInterval) clearInterval(keepAliveInterval);

    // Fire call_ended if not already sent (e.g. abrupt disconnect)
    if (!callEndedNotified) {
      callEndedNotified = true;
      notifyAgentBman('call_ended', {
        full_transcript:  transcriptBuffer.join('\n'),
        outcome:          callOutcome,
        direction:        callDirection,
        duration_seconds: null,
      });
    }

    if (dgWs) dgWs.close(1000, 'Client disconnected');
  });

}); // end wss.on('connection')

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[START] Orion Engine Running on Port ${PORT}`);
  console.log(`[CONFIG] AGENTBMAN_CALLBACK_URL:  ${process.env.AGENTBMAN_CALLBACK_URL  || 'NOT SET — set this env var on Render'}`);
  console.log(`[CONFIG] DEFAULT_TRANSFER_NUMBER: ${process.env.DEFAULT_TRANSFER_NUMBER || 'NOT SET'}`);
  console.log(`[CONFIG] DEEPGRAM_API_KEY:        ${process.env.DEEPGRAM_API_KEY  ? 'SET' : 'NOT SET'}`);
  console.log(`[CONFIG] CARTESIA_API_KEY:        ${process.env.CARTESIA_API_KEY  ? 'SET' : 'NOT SET'}`);
});

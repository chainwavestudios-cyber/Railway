import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

console.log('[START] Orion Engine Running');
console.log('[VERSION] Build v4 — Deepgram STT + gpt-4o-mini + Dynamic Voice (Deepgram Aura-2 / Cartesia managed) + AgentBman Sync + Multi-tenant + Inbound Support');

process.on('uncaughtException',  (err)    => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

// ── Each connection is a fully isolated scope ─────────────────────────────────
// 100 simultaneous calls = 100 independent closures. No shared state.
wss.on('connection', (ws, req) => {

  // ── Initial params from WebSocket query string (fallback only) ───────────────
  // The real values come from TwiML <Parameter> tags in the 'start' event.
  const queryParams  = url.parse(req.url, true).query;

  let leadId         = queryParams.l               || 'unknown';
  let campaignId     = queryParams.c               || 'unknown';
  let firstName      = queryParams.f               || 'there';
  let email          = queryParams.e               || '';
  let callDirection  = queryParams.direction       || 'outbound';
  let scriptId       = queryParams.script_id       || '';
  let customScript   = queryParams.script_text     || '';
  let callbackUrl    = queryParams.callback_url    || process.env.AGENTBMAN_CALLBACK_URL || '';
  let transferNumber = queryParams.transfer_number || process.env.DEFAULT_TRANSFER_NUMBER || '';

  // Voice — overridden per-call via TwiML params from twilioWebhook
  // which reads org SystemSettings so each org gets their chosen voice
  let voiceId       = queryParams.voice_id       || 'aura-2-thalia-en';
  let voiceProvider = queryParams.voice_provider || 'deepgram';
  let voiceModel    = queryParams.voice_model    || 'aura-2-thalia-en';

  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  // Per-connection state — completely isolated from all other calls
  let dgWs               = null;
  let streamSid          = null;
  let keepAliveInterval  = null;
  let transcriptBuffer   = [];
  let callOutcome        = 'completed';
  let callEndedNotified  = false;

  // ── POST back to AgentBman postCallSync ───────────────────────────────────────
  async function notifyAgentBman(tool, params = {}) {
    if (!callbackUrl) {
      console.warn(`[CALLBACK] No callback URL — cannot notify AgentBman of "${tool}"`);
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

  // ── Build Deepgram speak block ────────────────────────────────────────────────
  // Deepgram manages both Aura-2 and Cartesia natively — no separate API keys.
  // Both are included in the $4.50/hr flat rate.
  function buildSpeakBlock(provider, model, id) {
    if (provider === 'cartesia') {
      // Deepgram managed Cartesia — sonic-2 or sonic-3
      // No endpoint block, no Cartesia API key needed
      return {
        provider: {
          type:     'cartesia',
          model_id: model,  // 'sonic-2' or 'sonic-3'
          voice_id: id,     // UUID from Cartesia voice library
        }
      };
    }
    // Default: Deepgram Aura-2 native TTS
    return {
      provider: {
        type:  'deepgram',
        model: model,  // e.g. 'aura-2-thalia-en'
      }
    };
  }

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      // ── STREAM START ───────────────────────────────────────────────────────────
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        // customParameters contains values from TwiML <Stream><Parameter> tags.
        // These are set by twilioWebhook.ts which reads from each org's SystemSettings.
        // This is how per-org voice selection and per-call context are delivered.
        const customParams = msg.start.customParameters || {};

        // Call context
        if (customParams.f)               firstName      = customParams.f;
        if (customParams.l)               leadId         = customParams.l;
        if (customParams.c)               campaignId     = customParams.c;
        if (customParams.e)               email          = customParams.e;
        if (customParams.direction)       callDirection  = customParams.direction;
        if (customParams.script_id)       scriptId       = customParams.script_id;
        if (customParams.script_text)     customScript   = decodeURIComponent(customParams.script_text);
        if (customParams.callback_url)    callbackUrl    = customParams.callback_url;
        if (customParams.transfer_number) transferNumber = customParams.transfer_number;

        // Voice — read from org SystemSettings via twilioWebhook
        // Superusers can set cartesia_sonic3_voice_id which overrides everything
        if (customParams.voice_id)       voiceId       = customParams.voice_id;
        if (customParams.voice_provider) voiceProvider = customParams.voice_provider;
        if (customParams.voice_model)    voiceModel    = customParams.voice_model;

        const isInbound = callDirection === 'inbound';

        console.log(`[START] Stream: ${streamSid} | Lead: ${leadId} | Name: ${firstName} | Direction: ${callDirection}`);
        console.log(`[CONFIG] Campaign: ${campaignId} | Email: ${email}`);
        console.log(`[CONFIG] Callback: ${callbackUrl    || 'NOT SET'}`);
        console.log(`[CONFIG] Transfer#: ${transferNumber || 'NOT SET'}`);
        console.log(`[VOICE]  Provider: ${voiceProvider} | Model: ${voiceModel} | ID: ${voiceId}`);

        if (!deepgramApiKey) {
          console.error('[ERROR] DEEPGRAM_API_KEY not set — cannot connect to Deepgram');
          ws.close(1011, 'Deepgram API key not configured');
          return;
        }

        // ── Connect to Deepgram Voice Agent ───────────────────────────────────────
        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on('open', () => {
          console.log(`[DG] Connected | Lead: ${leadId} | Direction: ${callDirection} | Voice: ${voiceProvider}/${voiceId}`);

          keepAliveInterval = setInterval(() => {
            if (dgWs && dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          // ── Prompts ─────────────────────────────────────────────────────────────
          // These are FALLBACKS only — used when no custom script is assigned
          // to the campaign. The AI Agent Studio scripts are the primary path.
          const outboundPrompt = `You are Jordan, a sharp personable energy consultant calling homeowners. You sound completely human — relaxed, confident, direct. Short sentences. Natural rhythm. Never stiff or scripted.

RULES — never break these:
- Wait silently until they speak first. Do not say a single word until they say hello.
- Never say you are AI, a bot, automated, or calling on behalf of a system.
- One objection gets one response. If they say no twice, wish them well and end the call.
- Call live_transfer THE INSTANT they agree to talk to a specialist. No delay, no extra words first.
- Call book_appointment the instant they confirm a specific day and time.
- Keep every response under 3 sentences. Do not ramble.

STEP 1 — OPEN (wait for them to speak first, then:)
"Hey, is ${firstName} around?"
[They confirm]
"Hey ${firstName}, it's Jordan — got about 60 seconds?"

IF BUSY OR BAD TIME:
"Totally fine. I'm reaching out to homeowners in your area about some pretty big savings on energy bills. When works better — tomorrow morning?"
[Get a time, call book_appointment, end politely.]

STEP 2 — PITCH (only if they have time)
"So we're helping homeowners here cut their electric bills by 30 to 40 percent. I've got a specialist who can pull the actual numbers for your address right now — takes 5 minutes. Want me to connect you?"

IF YES → call live_transfer immediately. Say only: "Perfect, one second."
IF MAYBE → "No obligation at all — they just run the numbers free. Worth a look?"
IF YES TO THAT → call live_transfer immediately.

STEP 3 — BOOK IF NO TRANSFER
"Totally get it. Mornings or afternoons work better for you this week?"
[Confirm day and time, call book_appointment.]

HANDLING OBJECTIONS:
Already have solar → "This isn't just solar — we look at everything driving your bill. Might still find real savings. Worth 5 minutes?"
Who are you with → "We work with energy programs in your area — checking if you qualify before looping in a specialist. Completely free."
Not interested (first time) → "No worries — can I ask, are your bills pretty steady or have they been going up?"
Not interested (second time) → "Totally understand, I appreciate your time. Have a great day." [End call. Do NOT call any functions.]
`;

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

          // Primary path: custom script from AI Agent Studio (assigned per campaign).
          // Fallback: hardcoded Jordan (outbound) or Alex (inbound) prompts above.
          const prompt = customScript
            ? customScript.replace(/\{firstName\}/g, firstName)
            : isInbound ? inboundPrompt : outboundPrompt;

          if (customScript) {
            console.log(`[SCRIPT] Custom script (${customScript.length} chars) | id=${scriptId}`);
          } else {
            console.log(`[SCRIPT] Fallback ${isInbound ? 'inbound (Alex)' : 'outbound (Jordan)'} script`);
          }

          // ── Send Settings to Deepgram ───────────────────────────────────────────
          const speakBlock = buildSpeakBlock(voiceProvider, voiceModel, voiceId);

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
              speak: speakBlock
            }
          }));

          console.log(`[DG] Settings sent — speak: ${JSON.stringify(speakBlock)}`);

        }); // end dgWs.on('open')

        // ── Deepgram Messages ───────────────────────────────────────────────────
        dgWs.on('message', async (data, isBinary) => {
          // Binary = TTS audio — forward directly to Twilio
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

              // Real-time transcript stream to AgentBman (fire and forget)
              notifyAgentBman('transcript_update', {
                transcript_line: line,
                speaker: role === 'user' ? 'lead' : 'agent',
              });
            }

            // ── AI function calls ───────────────────────────────────────────────
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

                // Notify AgentBman — await so we know it landed
                await notifyAgentBman(call.name, callArgs);

                // Confirm result back to Deepgram so conversation continues
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

        dgWs.on('error', (e) => {
          console.error('[ERROR] Deepgram WS Error:', e.message);
        });

        dgWs.on('close', (code, reason) => {
          console.log('[CLOSE] Deepgram closed:', code, '|', reason ? reason.toString() : 'none');
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });

      } // end msg.event === 'start'

      // ── STT audio: Twilio → Deepgram ─────────────────────────────────────────
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

  // ── Client disconnected (abrupt hangup) ────────────────────────────────────
  ws.on('close', () => {
    console.log('[DISC] Client WebSocket disconnected');

    if (keepAliveInterval) clearInterval(keepAliveInterval);

    // Fire call_ended if not already sent
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
  console.log(`[START] Orion Engine listening on port ${PORT}`);
  console.log(`[CONFIG] AGENTBMAN_CALLBACK_URL:  ${process.env.AGENTBMAN_CALLBACK_URL  || 'NOT SET'}`);
  console.log(`[CONFIG] DEFAULT_TRANSFER_NUMBER: ${process.env.DEFAULT_TRANSFER_NUMBER || 'NOT SET'}`);
  console.log(`[CONFIG] DEEPGRAM_API_KEY:        ${process.env.DEEPGRAM_API_KEY        ? 'SET' : 'NOT SET ⚠️'}`);
  console.log('[CONFIG] CARTESIA_API_KEY:        NOT NEEDED — Cartesia managed by Deepgram');
  console.log('[INFO]   Voice selection per org via AgentBman SystemSettings → twilioWebhook → TwiML params');
  console.log('[INFO]   Multiple concurrent calls fully isolated — no shared state between connections');
});

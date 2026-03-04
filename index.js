import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

process.on('uncaughtException', (err) => console.error('[CRIT] CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason) => console.error('[WARN] UNHANDLED REJECTION:', reason));

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

// ─── G.711 mulaw decode table (ITU-T standard) ───────────────────────────────
const MULAW_DECODE = new Int16Array(256);
(function buildMulawTable() {
  for (let i = 0; i < 256; i++) {
    let ulaw = ~i & 0xFF;
    const sign = ulaw & 0x80;
    const exp  = (ulaw >> 4) & 0x07;
    const mant = ulaw & 0x0F;
    let sample = ((mant << 3) + 0x84) << exp;
    sample -= 0x84;
    MULAW_DECODE[i] = sign ? -sample : sample;
  }
})();

// FIX: Corrected interpolation — j goes 0,1,2 out of 3 steps toward next sample
// This prevents audio drift caused by never reaching the current sample's value
function mulawToPcm16_24k(mulawBuf) {
  const len = mulawBuf.length;
  const out = Buffer.allocUnsafe(len * 3 * 2);
  let outPos = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const curr = MULAW_DECODE[mulawBuf[i]];
    for (let j = 0; j < 3; j++) {
      // j/3 → 0, 0.333, 0.666 — arrives at curr on next iteration's prev
      // Fixed: use (j+1)/3 so samples step toward curr correctly
      const s = Math.round(prev + (curr - prev) * ((j + 1) / 3));
      out.writeInt16LE(Math.max(-32768, Math.min(32767, s)), outPos);
      outPos += 2;
    }
    prev = curr;
  }
  return out;
}

function encodeMulaw(sample) {
  const MU = 255;
  const sign = sample < 0 ? 0x80 : 0x00;
  if (sample < 0) sample = -sample;
  if (sample > 32767) sample = 32767;
  sample = Math.round(Math.log(1 + MU * sample / 32767) / Math.log(1 + MU) * 127);
  return (~(sign | sample)) & 0xFF;
}

function pcm16_24kToMulaw(pcmBuf) {
  const numSamples = Math.floor(pcmBuf.length / 2);
  const outLen = Math.floor(numSamples / 3);
  const out = Buffer.allocUnsafe(outLen);
  for (let i = 0; i < outLen; i++) {
    const sample = pcmBuf.readInt16LE(i * 6);
    out[i] = encodeMulaw(sample);
  }
  return out;
}

// ─── WebSocket connection handler ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const params     = url.parse(req.url, true).query;
  const firstName  = params.f || 'Philip';
  const leadId     = params.l || 'unknown';
  const campaignId = params.c || 'unknown';
  const email      = params.e || '';

  let inworldWs    = null;
  let streamSid    = null;
  let keepAlive    = null;
  let audioQueue   = [];
  let inworldReady = false;
  let mediaCount   = 0;
  let silenceTimer = null;
  let hasAudio     = false;

  function scheduleCommit() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!inworldWs || inworldWs.readyState !== WebSocket.OPEN || !hasAudio) {
        console.log('[VAD] Silence timer fired but skipping — hasAudio: ' + hasAudio + ' wsState: ' + (inworldWs?.readyState));
        return;
      }
      console.log('[VAD] Committing audio + firing response.create');
      hasAudio = false;
      inworldWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      inworldWs.send(JSON.stringify({ type: 'response.create' }));
    }, 800); // 800ms — Twilio sends ~50 packets/sec so this is ~40 packets of silence
  }

  // Detect silence by checking if mulaw payload is near-silent (all ~0x7F = mulaw silence)
  function isSilent(mulawBuf) {
    let count = 0;
    for (let i = 0; i < mulawBuf.length; i++) {
      if (mulawBuf[i] === 0x7F || mulawBuf[i] === 0xFF) count++;
    }
    return count / mulawBuf.length > 0.95; // 95% silence bytes = silent frame
  }

  const prompt = `Identity: You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.

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

  // ── Connect to Inworld Realtime API ─────────────────────────────────────
  function connectInworld() {
    const apiKey    = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      console.error('[INWORLD] INWORLD_API_KEY not set');
      return;
    }
    const authHeader = `Basic ${apiKey}`;
    const sessionId = randomUUID();
    const wsUrl = `wss://api.inworld.ai/api/v1/realtime/session?key=${sessionId}&protocol=realtime`;
    console.log('[INWORLD] Connecting | session: ' + sessionId);

    inworldWs = new WebSocket(wsUrl, {
      headers: { 'Authorization': authHeader }
    });

    inworldWs.on('open', () => {
      console.log('[INWORLD] Connected');

      // FIX 1: Added model at top level so LLM activates correctly
      // FIX 2: Added input_audio_transcription at top level (required by Inworld protocol)
      // FIX 3: Added explicit input audio format definition
      // FIX 4: Switched to server_vad with threshold 0.4 for reliable "Hello" detection
      // FIX 5: Added explicit output format definition to guarantee 24kHz PCM back
      inworldWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          model: 'llama-3.3-70b-versatile',
          output_modalities: ['audio', 'text'],
          instructions: prompt,
          audio: {
            input: {
              transcription: {
                model: 'assemblyai/universal-streaming-multilingual'
              },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'high',
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
              description: 'Call this as soon as the lead confirms a day and AM or PM. Include qualifier answers in notes.',
              parameters: {
                type: 'object',
                properties: {
                  day: { type: 'string', description: 'Day they agreed to e.g. today, tomorrow, Monday' },
                  time_of_day: { type: 'string', enum: ['AM', 'PM'] },
                  notes: { type: 'string', description: 'Qualifier answers: prior metals, liquidity, retirement interest' }
                },
                required: ['day', 'time_of_day']
              }
            },
            {
              type: 'function',
              name: 'send_newsletter',
              description: "Call this if the lead agreed to receive Chris's bi-weekly newsletter.",
              parameters: {
                type: 'object',
                properties: {
                  confirmed: { type: 'boolean' }
                },
                required: ['confirmed']
              }
            }
          ]
        }
      }));

      keepAlive = setInterval(() => {
        if (inworldWs && inworldWs.readyState === WebSocket.OPEN) {
          inworldWs.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
    });

    inworldWs.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch (e) { return; }

      console.log('[INWORLD RAW]', JSON.stringify(msg).substring(0, 800));

      if (msg.type === 'session.updated') {
        const vad = msg.session?.audio?.input?.turn_detection?.type || msg.session?.turn_detection?.type || 'unknown';
        const voice = msg.session?.audio?.output?.voice || 'unknown';
        const instructions_len = msg.session?.instructions?.length || 0;
        console.log(`[INWORLD] Session updated | VAD: ${vad} | Voice: ${voice} | Instructions: ${instructions_len} chars`);
        inworldReady = true;

        if (audioQueue.length > 0) {
          console.log(`[QUEUE] Flushing ${audioQueue.length} buffered packets`);
          for (const pcmBuf of audioQueue) {
            if (inworldWs.readyState === WebSocket.OPEN) {
              inworldWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: pcmBuf.toString('base64')
              }));
            }
          }
          audioQueue = [];
        }

        console.log('[INWORLD] Ready — waiting for caller audio');
      }

      if (msg.type === 'conversation.item.added' && msg.item?.content) {
        console.log('[CHAT] ' + msg.item.role + ': ' + JSON.stringify(msg.item.content));
      }

      // ─── AUDIO: PCM16 24kHz → mulaw 8kHz → Twilio ───────────────────────
      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        if (ws.readyState === WebSocket.OPEN && streamSid) {
          try {
            const pcmBuf   = Buffer.from(msg.delta, 'base64');
            const mulawBuf = pcm16_24kToMulaw(pcmBuf);
            ws.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: mulawBuf.toString('base64') }
            }));
          } catch (e) {
            console.error('[AUDIO] Conversion error:', e.message);
          }
        }
      }

      if (msg.type === 'response.output_audio_transcript.done') {
        console.log('[TRANSCRIPT] ' + msg.transcript);
      }

      if (msg.type === 'response.function_call_arguments.done') {
        const fnName = msg.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(msg.arguments || '{}'); } catch (e) {}
        console.log('[TOOL] ' + fnName + ' | ' + JSON.stringify(fnArgs));

        fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: fnName, lead_id: leadId, campaign_id: campaignId, params: fnArgs, email })
        }).catch(e => console.error('Sync Error:', e));

        if (inworldWs.readyState === WebSocket.OPEN) {
          inworldWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify({ status: 'success' }) }
          }));
          inworldWs.send(JSON.stringify({ type: 'response.create' }));
        }
      }

      if (msg.type === 'response.done') console.log('[DONE] Response complete');
      if (msg.type === 'error') console.error('[INWORLD ERROR]', JSON.stringify(msg));
    });

    inworldWs.on('error', (e) => console.error('[INWORLD] WS Error:', e.message));
    inworldWs.on('close', (code, reason) => {
      console.log('[CLOSE] Inworld closed: ' + code + ' | Reason: ' + (reason ? reason.toString() : ''));
      if (keepAlive) clearInterval(keepAlive);
    });
  }

  // ── Twilio media stream messages ──────────────────────────────────────────
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('[START] Stream: ' + streamSid + ' | Lead: ' + leadId);
        connectInworld();
      }

      if (msg.event === 'media') {
        const mulawBuf = Buffer.from(msg.media.payload, 'base64');
        if (mulawBuf.length === 0) return;

        const pcmBuf = mulawToPcm16_24k(mulawBuf);
        mediaCount++;
        if (mediaCount % 50 === 0) console.log('[MEDIA] Packets sent to Inworld: ' + mediaCount);

        if (!inworldReady || !inworldWs || inworldWs.readyState !== WebSocket.OPEN) {
          audioQueue.push(pcmBuf);
        } else {
          // Only mark hasAudio and schedule commit if this frame has actual speech
          if (!isSilent(mulawBuf)) {
            if (!hasAudio) console.log('[VAD] Speech detected');
            hasAudio = true;
          }
          inworldWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: pcmBuf.toString('base64')
          }));
          scheduleCommit();
        }
      }

      if (msg.event === 'stop') {
        console.log('[STOP] Stream stopped: ' + streamSid);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (keepAlive) clearInterval(keepAlive);
        if (inworldWs) inworldWs.close(1000, 'Call ended');
      }
    } catch (err) {
      console.error('[WS] Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[DISC] Client disconnected');
    if (keepAlive) clearInterval(keepAlive);
    if (inworldWs) inworldWs.close(1000, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log('[START] Orion Engine Running on Port ' + PORT));

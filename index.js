import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

const PORT = process.env.PORT || 8080;

const app = express();
app.get('/health', (_, res) => res.send('OK'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

console.log('[START] Orion Engine Running on Port', PORT);
console.log('[VERSION] Build v64 — fix format mismatch pcm 24k everywhere');

// ─── Audio conversion ────────────────────────────────────────────────────────
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

function twilioToInworld(base64Mulaw) {
  const mulawBuf = Buffer.from(base64Mulaw, 'base64');
  const len = mulawBuf.length;
  const pcm8k = new Int16Array(len);
  for (let i = 0; i < len; i++) pcm8k[i] = MULAW_DECODE[mulawBuf[i]];

  // Catmull-Rom cubic upsample 8k -> 24k
  const outLen = len * 3;
  const out = Buffer.allocUnsafe(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / 3;
    const srcIdx = Math.floor(srcPos);
    const t = srcPos - srcIdx;
    const p0 = pcm8k[Math.max(0, srcIdx - 1)];
    const p1 = pcm8k[Math.min(len - 1, srcIdx)];
    const p2 = pcm8k[Math.min(len - 1, srcIdx + 1)];
    const p3 = pcm8k[Math.min(len - 1, srcIdx + 2)];
    const a = -0.5*p0 + 1.5*p1 - 1.5*p2 + 0.5*p3;
    const b = p0 - 2.5*p1 + 2*p2 - 0.5*p3;
    const cc = -0.5*p0 + 0.5*p2;
    const sample = a*t*t*t + b*t*t + cc*t + p1;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
  }
  return out.toString('base64');
}

function inworldToTwilio(base64Pcm) {
  const pcmBuf = Buffer.from(base64Pcm, 'base64');
  const numSamples = Math.floor(pcmBuf.length / 2);
  const outLen = Math.floor(numSamples / 3);
  const out = Buffer.allocUnsafe(outLen);
  const MU = 255;
  for (let i = 0; i < outLen; i++) {
    const s0 = pcmBuf.readInt16LE(i * 6);
    const s1 = (i*6+2 < pcmBuf.length) ? pcmBuf.readInt16LE(i*6+2) : s0;
    const s2 = (i*6+4 < pcmBuf.length) ? pcmBuf.readInt16LE(i*6+4) : s0;
    let sample = Math.round((s0+s1+s2)/3);
    const sign = sample < 0 ? 0x80 : 0x00;
    if (sample < 0) sample = -sample;
    if (sample > 32767) sample = 32767;
    sample = Math.round(Math.log(1 + MU*sample/32767) / Math.log(1+MU) * 127);
    out[i] = (~(sign | sample)) & 0xFF;
  }
  return out.toString('base64');
}

wss.on('connection', (browser) => {
  let streamSid = null;
  let inworld = null;
  let sessionReady = false;
  let reconnectAttempts = 0;
  let audioQueue = [];
  let callActive = false;
  let silenceTimer = null;
  let audioAppended = false;
  let appendCount = 0;
  let frameBuffer = [];
  let isPlaying = false;
  let echoBuffer = Buffer.alloc(0); // reference of what Orion is saying
  let audioAccum = Buffer.alloc(0);
  const ACCUM_TARGET = 4800; // 5 packets = 100ms chunks (Inworld recommended)
  let pendingResponseAfterCommit = false;
  let leadId = 'unknown';
  let campaignId = 'unknown';
  let email = '';
  let callerFirstName = 'friend';

  const MAX_RECONNECTS = 3;

  function connectInworld(firstName = 'friend') {
    console.log('[INWORLD] Connecting | session:', streamSid);

    const key = 'YWF2QmVkNTE2ZzlTamFpUERHaHBna3pIa09yY0VEazI6aElUZkhQM0x0aWE3ZDFMcmpKdzdndVJKZ3lLQTlPYzZyNVY5ZzRMcTUxOU9Zbm5ydmh2T2FVMFpodkpuTFBlcw==';

    inworld = new WebSocket(
      `wss://api.inworld.ai/api/v1/realtime/session?key=voice-${Date.now()}&protocol=realtime`,
      { headers: { Authorization: `Basic ${key}` } }
    );

    const sessionTimeout = setTimeout(() => {
      if (!sessionReady) {
        console.log('[TIMEOUT] session.created never received');
        inworld.close();
      }
    }, 10000);

    const prompt = `Identity: You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.

Vocal Style:
Tone: Calm, confident, assertive, upbeat, and enthusiastic.
Pacing: Eliminate passive pauses. Use "..." only for emphasis (maximum 300ms). NEVER pause to wait for validation. Maintain forward momentum at all times.
Delivery: Declarative, certain, energetic. Do not sound like you are asking permission to continue. Drive the conversation.
Formatting: Never read markup or punctuation aloud. Use natural contractions to sound human.
Adherence: You are an actor. Recite the PHASES exactly as written.

Core Rules:
Silence Start: NEVER speak first. Wait for the prospect to say something.
The Hook: The instant the prospect speaks, your ONLY response is: "Hello, may I speak with ${firstName}?"
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

    inworld.on('open', () => {
      console.log('[INWORLD] WebSocket open — waiting for session.created');
    });

    inworld.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      console.log('[INWORLD RAW]', msg.type);

      if (msg.type === 'session.created') {
        clearTimeout(sessionTimeout);
        reconnectAttempts = 0;
        console.log('[INWORLD] Session created — sending config');

        const sessionPayload = {
          type: 'session.update',
          session: {
            model: 'gemini-2.5-flash',
            output_modalities: ['audio', 'text'],
            instructions: prompt,
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.3,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                },
              },
              output: {
                voice: 'default-zrwumrrhegpobn7fjiz5mq__chris',
                model: 'inworld-tts-1.5-max',
                format: { type: 'audio/pcm', rate: 24000 },
              },
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
                    notes: { type: 'string', description: 'Qualifier answers: prior metals, liquidity, retirement interest' },
                  },
                  required: ['day', 'time_of_day'],
                },
              },
              {
                type: 'function',
                name: 'send_newsletter',
                description: "Call this if the lead agreed to receive Chris's bi-weekly newsletter.",
                parameters: {
                  type: 'object',
                  properties: {
                    confirmed: { type: 'boolean' },
                  },
                  required: ['confirmed'],
                },
              },
            ],
            temperature: 0.8,
          },
        };
        inworld.send(JSON.stringify(sessionPayload));
      }

      if (msg.type === 'session.updated') {
        const vad = msg.session?.audio?.input?.turn_detection?.type || 'unknown';
        const voice = msg.session?.audio?.output?.voice || 'unknown';
        console.log(`[INWORLD] Session updated | VAD: ${vad} | Voice: ${voice}`);
        sessionReady = true;

        // Flush any buffered audio
        if (audioQueue.length > 0) {
          console.log(`[QUEUE] Flushing ${audioQueue.length} buffered audio packets`);
          for (const chunk of audioQueue) {
            if (inworld.readyState === WebSocket.OPEN) {
              audioAccum = Buffer.concat([audioAccum, chunk]);
            }
          }
          // Send any accumulated audio immediately
          if (audioAccum.length > 0 && inworld.readyState === WebSocket.OPEN) {
            inworld.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: audioAccum.toString('base64'),
            }));
            audioAccum = Buffer.alloc(0);
          }
          audioQueue = [];
        }

        // Trigger opening greeting
        setTimeout(() => {
          if (inworld && inworld.readyState === WebSocket.OPEN) {
            inworld.send(JSON.stringify({
              type: 'conversation.item.create',
              item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
            }));
            inworld.send(JSON.stringify({ type: 'response.create' }));
            console.log('[GREET] Opening greeting triggered');
          }
        }, 500);

        console.log('[INWORLD] Ready — waiting for caller audio');
      }

      if (msg.type === 'conversation.item.added' && msg.item?.content) {
        console.log('[CHAT]', msg.item.role + ':', JSON.stringify(msg.item.content));
      }

      // ─── AUDIO: PCM16 24kHz → mulaw 8kHz → Twilio ───────────────────────
      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        if (browser.readyState === WebSocket.OPEN && streamSid) {
          try {
            const mulawBuf = Buffer.from(inworldToTwilio(msg.delta), 'base64');
            for (let i = 0; i < mulawBuf.length; i += 160) {
              const chunk = mulawBuf.slice(i, i + 160);
              browser.send(JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: chunk.toString('base64') },
              }));
            }
          } catch (e) {
            console.error('[AUDIO] Conversion error:', e.message);
          }
        }
      }

      if (msg.type === 'response.output_audio_transcript.done') {
        console.log('[TRANSCRIPT]', msg.transcript);
      }

      if (msg.type === 'response.function_call_arguments.done') {
        const fnName = msg.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(msg.arguments || '{}'); } catch (e) {}
        console.log('[TOOL]', fnName, '|', JSON.stringify(fnArgs));

        fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: fnName, lead_id: leadId, campaign_id: campaignId, params: fnArgs, email }),
        }).catch(e => console.error('Sync Error:', e));

        if (inworld.readyState === WebSocket.OPEN) {
          inworld.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify({ status: 'success' }) },
          }));
          inworld.send(JSON.stringify({ type: 'response.create' }));
        }
      }

      if (msg.type === 'input_audio_buffer.committed') {
        console.log('[COMMITTED] Buffer committed — creating response');
        if (pendingResponseAfterCommit && inworld.readyState === WebSocket.OPEN) {
          pendingResponseAfterCommit = false;
          inworld.send(JSON.stringify({ type: 'response.create' }));
        }
      }

      if (msg.type === 'input_audio_buffer.speech_started') {
        console.log('[VAD] Speech started detected!');
      }
      if (msg.type === 'input_audio_buffer.speech_stopped') {
        console.log('[VAD] Speech stopped detected!');
      }
      if (msg.type === 'conversation.item.input_audio_transcription.completed') {
        console.log('[STT]', msg.transcript);
      }

      if (msg.type === 'response.output_audio.delta') {
        isPlaying = true;
        audioAccum = Buffer.alloc(0);
        // Store Orion's PCM output as echo reference for cancellation
        try {
          const orionPcm = Buffer.from(msg.delta, 'base64');
          echoBuffer = Buffer.concat([echoBuffer, orionPcm]);
          // Keep only last 2 seconds worth
          if (echoBuffer.length > 24000 * 2 * 2) {
            echoBuffer = echoBuffer.slice(echoBuffer.length - 24000 * 2 * 2);
          }
        } catch(e) {}
      }
      if (msg.type === 'response.output_audio.done') {
        setTimeout(() => {
          isPlaying = false;
          echoBuffer = Buffer.alloc(0); // clear echo reference
        }, 400);
      }
      if (msg.type === 'response.done') {
        console.log('[DONE] Response complete');
        isPlaying = false;
        // Reset VAD state after each response
        if (inworld && inworld.readyState === WebSocket.OPEN) {
          inworld.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
          console.log('[RESET] Audio buffer cleared for next turn');
          audioAccum = Buffer.alloc(0);
        }
      }
      if (msg.type === 'error') console.error('[INWORLD ERROR]', JSON.stringify(msg));
    });

    inworld.on('close', (code) => {
      console.log('[INWORLD] Closed (' + code + ')');
      sessionReady = false;
      if (callActive && reconnectAttempts < MAX_RECONNECTS) {
        reconnectAttempts++;
        console.log('[RECONNECT] Attempt', reconnectAttempts);
        setTimeout(() => connectInworld(callerFirstName), 1000);
      }
    });

    inworld.on('error', (err) => {
      console.error('[INWORLD] WS Error:', err.message);
    });
  }

  browser.on('message', (message) => {
    let msg;
    try { msg = JSON.parse(message.toString()); } catch { return; }
    if (msg.event !== 'media') console.log('[TWILIO]', msg.event);
    if (msg.event === 'media' && msg.media?.track) { /* track ok */ }

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      leadId = msg.start.customParameters?.l || 'unknown';
      campaignId = msg.start.customParameters?.c || 'unknown';
      email = msg.start.customParameters?.e || '';
      callerFirstName = msg.start.customParameters?.f || msg.start.customParameters?.firstName || 'friend';
      callActive = true;
      console.log('[START] Stream:', streamSid, '| Lead:', leadId, '| Name:', callerFirstName);
      connectInworld(callerFirstName);
    }

    if (msg.event === 'media') {
      if (msg.media.track === 'outbound') return; // skip Orion's own audio
      const pcmBuf = Buffer.from(twilioToInworld(msg.media.payload), 'base64'); // PCM16 24kHz

      if (!sessionReady || !inworld || inworld.readyState !== WebSocket.OPEN) {
        audioQueue.push(pcmBuf); // stores converted PCM
        return;
      }

      // Block input while Orion is speaking to prevent echo
      if (isPlaying) return;
      // console.log('[GATE] Audio flowing — isPlaying false'); // too noisy

      appendCount++;
      if (appendCount % 25 === 0) console.log('[AUDIO] Sent', appendCount, 'packets to Inworld');
      inworld.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcmBuf.toString('base64'),
      }));





    }

    if (msg.event === 'stop') {
      callActive = false;
      console.log('[STOP] Stream stopped:', streamSid);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (inworld && inworld.readyState === WebSocket.OPEN) {
        inworld.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      }
      audioQueue = [];
      if (inworld) inworld.close();
    }
  });

  browser.on('close', () => {
    console.log('[DISC] Client disconnected');
    if (silenceTimer) clearTimeout(silenceTimer);
    audioQueue = [];
    if (inworld) inworld.close();
  });
});

server.listen(PORT);

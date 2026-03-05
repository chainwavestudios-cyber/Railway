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
console.log('[VERSION] Build v58 — fix mulawDecode exponent=0, fix queue flush');

// ─── Audio conversion utils (from Inworld support) ──────────────────────────

function mulawDecode(mulawByte) {
  const BIAS = 0x84;
  const mulawByteInverted = ~mulawByte;
  const sign = mulawByteInverted & 0x80;
  const exponent = (mulawByteInverted >> 4) & 0x07;
  const mantissa = mulawByteInverted & 0x0f;
  let magnitude = exponent > 0 ? (((mantissa << 3) | BIAS) << (exponent - 1)) : ((mantissa << 3) | BIAS) >> 1;
  return sign ? magnitude : -magnitude;
}

function mulawEncode(pcmSample) {
  const BIAS = 0x84;
  const MAX = 32635;
  let sign = (pcmSample >> 8) & 0x80;
  if (sign) pcmSample = -pcmSample;
  if (pcmSample > MAX) pcmSample = MAX;
  pcmSample = pcmSample + BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (pcmSample & expMask) === 0; expMask >>= 1) {
    exponent--;
  }
  const mantissa = (pcmSample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function resampleLinear(buffer, fromRate, toRate) {
  if (fromRate === toRate) return buffer;
  const inputSamples = buffer.length / 2;
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;
    const sample1 = buffer.readInt16LE(srcIndexFloor * 2);
    const sample2 = buffer.readInt16LE(srcIndexCeil * 2);
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);
    output.writeInt16LE(interpolated, i * 2);
  }
  return output;
}

function twilioToInworld(base64Mulaw) {
  const mulawBuffer = Buffer.from(base64Mulaw, 'base64');
  const pcm8k = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    pcm8k.writeInt16LE(mulawDecode(mulawBuffer[i]), i * 2);
  }
  const pcm24k = resampleLinear(pcm8k, 8000, 24000);
  return pcm24k.toString('base64');
}

function inworldToTwilio(base64Pcm) {
  const pcm24k = Buffer.from(base64Pcm, 'base64');
  const pcm8k = resampleLinear(pcm24k, 24000, 8000);
  const mulaw = Buffer.alloc(pcm8k.length / 2);
  for (let i = 0; i < pcm8k.length; i += 2) {
    mulaw[i / 2] = mulawEncode(pcm8k.readInt16LE(i));
  }
  return mulaw.toString('base64');
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
                format: { type: 'audio/pcmu', rate: 8000 },
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
                format: { type: 'audio/pcmu', rate: 8000 },
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
            const mulawB64 = inworldToTwilio(msg.delta);
            const mulawBuf = Buffer.from(mulawB64, 'base64');
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
      const pcmBuf = Buffer.from(twilioToInworld(msg.media.payload), 'base64');

      if (!sessionReady || !inworld || inworld.readyState !== WebSocket.OPEN) {
        audioQueue.push(pcmBuf); // stores converted PCM
        return;
      }

      // Echo cancellation: subtract Orion's voice from input
      let cleanBuf = pcmBuf;
      if (isPlaying && echoBuffer.length > 0) {
        cleanBuf = Buffer.allocUnsafe(pcmBuf.length);
        for (let i = 0; i < pcmBuf.length; i += 2) {
          const incoming = pcmBuf.readInt16LE(i);
          // Downsample echo ref index (24k -> 8k -> back up, offset by Twilio latency ~100ms)
          const echoIdx = Math.min(echoBuffer.length - 2, i * 3);
          const echo = echoBuffer.readInt16LE(echoIdx - (echoIdx % 2));
          const cancelled = Math.max(-32768, Math.min(32767, incoming - Math.round(echo * 0.8)));
          cleanBuf.writeInt16LE(cancelled, i);
        }
        // Check if anything is left after cancellation (RMS > 500 = real speech)
        let sum = 0;
        for (let i = 0; i < cleanBuf.length; i += 2) {
          const s = cleanBuf.readInt16LE(i);
          sum += s * s;
        }
        const rms = Math.sqrt(sum / (cleanBuf.length / 2));
        if (rms < 500) return; // pure echo, skip
      }

      audioAccum = Buffer.concat([audioAccum, pcmBuf]);
      appendCount++;

      if (audioAccum.length >= ACCUM_TARGET) {
        const audioB64 = audioAccum.toString('base64');
        inworld.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: audioB64,
        }));
        audioAccum = Buffer.alloc(0);

      }





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

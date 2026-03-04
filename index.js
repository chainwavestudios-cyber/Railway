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

// ─── Auth diagnostic ──────────────────────────────────────────────────────────
const _diagKey = process.env.INWORLD_API_KEY;
if (!_diagKey) {
  console.error('[AUTH] INWORLD_API_KEY is NOT SET — all connections will 401');
} else {
  console.log(`[AUTH] INWORLD_API_KEY present | length: ${_diagKey.length} | first 8 chars: ${_diagKey.substring(0, 8)}...`);
}

// ─── G.711 mulaw decode table ────────────────────────────────────────────────
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

function mulawToPcm16_24k(mulawBuf) {
  const len = mulawBuf.length;
  const out = Buffer.allocUnsafe(len * 3 * 2);
  let outPos = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const curr = MULAW_DECODE[mulawBuf[i]];
    for (let j = 0; j < 3; j++) {
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
  let silenceTimer = null;
  let hasAudio     = false;

  function scheduleCommit() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!inworldWs || inworldWs.readyState !== WebSocket.OPEN || !hasAudio) return;
      hasAudio = false;
      inworldWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      inworldWs.send(JSON.stringify({ type: 'response.create' }));
    }, 800);
  }

  function isSilent(mulawBuf) {
    let count = 0;
    for (let i = 0; i < mulawBuf.length; i++) {
      if (mulawBuf[i] === 0x7F || mulawBuf[i] === 0xFF) count++;
    }
    return count / mulawBuf.length > 0.95;
  }

  const prompt = `<<< YOUR ORIGINAL PROMPT REMAINS UNCHANGED HERE >>>`;

  function connectInworld() {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) return;

    console.log('[AUTH DEBUG]', {
      length: apiKey.length,
      first8: apiKey.substring(0,8),
      last8: apiKey.substring(apiKey.length - 8)
    });

    // 🔥 HARD CODED SESSION KEY
    const wsUrl = 'wss://api.inworld.ai/api/v1/realtime/session?key=test&protocol=realtime';

    inworldWs = new WebSocket(wsUrl, {
      headers: { Authorization: `Basic ${apiKey}` }
    });

    inworldWs.on('open', () => {
      console.log('[INWORLD] WebSocket open');
    });

    inworldWs.on('message', (data) => {
      console.log('[INWORLD] RAW MESSAGE:', data.toString());

      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'session.created') {
        inworldWs.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            modelId: 'auto',
            output_modalities: ['audio', 'text'],
            instructions: prompt,
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: 'high',
                  create_response: true,
                  interrupt_response: true
                }
              },
              output: {
                format: { type: 'audio/pcm', rate: 24000 },
                voice: 'Dennis',
                model: 'inworld-tts-1.5-mini',
                speed: 1.0
              }
            }
          }
        }));
      }

      if (msg.type === 'session.updated') {
        inworldReady = true;
      }

      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        if (ws.readyState === WebSocket.OPEN && streamSid) {
          const pcmBuf   = Buffer.from(msg.delta, 'base64');
          const mulawBuf = pcm16_24kToMulaw(pcmBuf);
          ws.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: mulawBuf.toString('base64') }
          }));
        }
      }
    });

    inworldWs.on('close', (code, reason) => {
      console.warn(`[INWORLD] Closed (${code}) ${reason}`);
    });

    inworldWs.on('error', (err) => {
      console.error('[INWORLD] WS Error:', err.message);
    });
  }

  ws.on('message', (message) => {
    const msg = JSON.parse(message);

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      connectInworld();
    }

    if (msg.event === 'media') {
      const mulawBuf = Buffer.from(msg.media.payload, 'base64');
      if (!mulawBuf.length) return;

      const pcmBuf = mulawToPcm16_24k(mulawBuf);

      if (inworldReady && inworldWs?.readyState === WebSocket.OPEN) {
        if (!isSilent(mulawBuf)) hasAudio = true;
        inworldWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcmBuf.toString('base64')
        }));
        scheduleCommit();
      }
    }
  });

  ws.on('close', () => {
    if (keepAlive) clearInterval(keepAlive);
    if (inworldWs) inworldWs.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () =>
  console.log('[START] Orion Engine Running on Port ' + PORT)
);

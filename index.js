import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => res.status(200).send('Orion Engine Live'));

process.on('uncaughtException', (err) => console.error('[CRIT]', err));
process.on('unhandledRejection', (reason) => console.error('[WARN]', reason));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'there';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const email = parameters.e || '';
  const callbackUrl = parameters.callback_url || process.env.AGENTBMAN_CALLBACK_URL;
  const transferNumber = parameters.transfer_number || process.env.DEFAULT_TRANSFER_NUMBER;
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;
  let transcriptBuffer = [];

  // Helper: POST back to AgentBman
  async function notifyAgentBman(tool, params = {}) {
    if (!callbackUrl) return;
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool,
          lead_id: leadId,
          campaign_id: campaignId,
          email,
          params,
        }),
      });
    } catch (err) {
      console.error('[CALLBACK] Failed:', err.message);
    }
  }

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        // Read params passed via TwiML <Parameter> tags
        const customParams = msg.start.customParameters || {};
        const f = customParams.f || firstName;
        const l = customParams.l || leadId;
        const cb = customParams.callback_url || callbackUrl;

        console.log(`[START] Stream: ${streamSid} | Lead: ${l} | Name: ${f}`);

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on('open', () => {
          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          const prompt = `Identity: You are Alex, an AI outbound sales agent calling on behalf of the team.

Vocal Style:
- Calm, confident, direct. Human-sounding, natural contractions.
- Do NOT pause after statements waiting for validation.
- Keep momentum. One sentence flows immediately into the next.
- Never read markup aloud.

Primary Objective: Get a LIVE TRANSFER to a sales agent.
Backup Objective: Book an appointment if live transfer is declined.

Core Rules:
- NEVER speak first. Wait for prospect to say something.
- If they confirm they can talk, move straight to Phase 2.
- Call live_transfer the INSTANT they agree to speak with someone now.
- Call book_appointment if they prefer a scheduled callback.
- If not interested after one objection response, end politely.

PHASE 1 - OPEN
(Wait for them to say hello)
"Hi, is this ${f}?"
(After confirmed)
"Hey ${f}, hope I'm not catching you at a bad time?"

IF BUSY:
"No problem at all — I'll be super quick. I'm calling about something that might save you money on your energy bills. When's a better time to connect for 2 minutes?"
(Wait for response)

IF AVAILABLE:
Move to Phase 2 immediately.

PHASE 2 - PITCH
"Great. So the reason I'm reaching out — we work with homeowners in your area who've seen their energy costs go up, and we help them lock in significant savings. A lot of people are seeing 30 to 50 percent off their monthly bills."
"I actually have one of our senior energy specialists available right now who can walk you through exactly what savings would look like for your specific property. It takes about 5 minutes. Can I connect you with them right now?"

IF YES TO LIVE TRANSFER:
(Call live_transfer immediately)
"Perfect — connecting you now. One moment."

IF PREFERS APPOINTMENT:
"Totally understand. Let's set up a quick call at a time that works for you. Does tomorrow morning or afternoon work better?"
(Wait for response, then call book_appointment)

PHASE 3 - OBJECTIONS

OBJECTION: Already have solar / not interested in solar
"Completely understand ${f}. This isn't specifically about solar — we look at the full picture of what's driving your energy costs and find the best fit. Worth a quick 5 minutes with our specialist?"

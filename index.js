import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createClient } from '@base44/sdk';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * 1. RAILWAY & BASE44 HEALTHCHECK
 * This satisfies Railway's "Service Unavailable" error and 
 * provides the Deepgram diagnostic data to your dashboard.
 */
app.get('/health', async (req, res) => {
  const start = Date.now();
  let deepgramStatus = { connected: false, latency_ms: 0, error: null };

  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is missing from Railway Variables.");
    }

    // Ping Deepgram (logic from your Checkdeepgram.ts)
    const dgRes = await fetch('https://api.deepgram.com/v1/projects', {
      method: 'GET',
      headers: { 
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json'
      },
    });

    deepgramStatus.latency_ms = Date.now() - start;
    
    if (dgRes.ok) {
      deepgramStatus.connected = true;
    } else {
      const errorText = await dgRes.text();
      deepgramStatus.error = `Deepgram Error ${dgRes.status}: ${errorText}`;
    }
  } catch (error) {
    deepgramStatus.error = error.message;
  }

  // Return 200 so Railway marks the deployment as "Healthy"
  res.status(200).json({
    status: 'ok',
    engine: 'active',
    deepgram: deepgramStatus,
    timestamp: new Date().toISOString()
  });
});

/**
 * 2. INITIALIZE BASE44 CLIENT
 */
const base44 = createClient({
  appId: process.env.BASE44_APP_ID, 
  token: process.env.BASE44_ADMIN_TOKEN, 
});

/**
 * 3. VOICE ENGINE (WEBSOCKET)
 */
wss.on('connection', async (ws, req) => {
  const params = new URLSearchParams(req.url.split('?')[1]);
  const campaignId = params.get('c');
  const leadId = params.get('l');

  console.log(`[Railway] New Session: Campaign ${campaignId}, Lead ${leadId}`);

  let dgWs = null;
  let streamSid = null;
  let callLogId = null;
  let fullTranscript = "";

  try {
    const [campaign] = await base44.entities.Campaign.filter({ id: campaignId });
    const [lead] = await base44.entities.Lead.filter({ id: leadId });

    ws.on('message', async (message) => {
      const msg = JSON.parse(message);
      
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        const logs = await base44.entities.CallLog.filter({ twilio_call_sid: streamSid });
        if (logs[0]) {
          callLogId = logs[0].id;
          await base44.asServiceRole.entities.CallLog.update(callLogId, { status: 'in_progress' });
        }

        dgWs = new WebSocket(`wss://agent.deepgram.com/v1/agent/converse?token=${process.env.DEEPGRAM_API_KEY}`);

        dgWs.on('open', () => {
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: { 
                provider: { type: campaign?.llm_provider || 'open_ai', model: campaign?.llm_model || 'gpt-4o-mini' }, 
                instructions: campaign?.agent_prompt 
              },
              speak: { model: campaign?.agent_voice || 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', async (data) => {
          if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: data.toString('base64') } }));
          }
          if (typeof data === 'string') {
            const response = JSON.parse(data);
            if (response.type === 'UtteranceEnd') {
              const text = response.channel.alternatives[0].transcript;
              fullTranscript += `${response.is_final ? "[agent]" : "[user]"} ${text}\n`;
              if (callLogId) base44.asServiceRole.entities.CallLog.update(callLogId, { live_transcript: fullTranscript });
            }
          }
        });
      }
      
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }
    });

    ws.on('close', async () => {
      if (dgWs) dgWs.close();
      if (callLogId) await base44.asServiceRole.entities.CallLog.update(callLogId, { status: 'completed', transcript: fullTranscript });
    });
  } catch (err) {
    console.error("Error:", err.message);
    ws.close();
  }
});

// MANDATORY: Listen on 0.0.0.0 for Railway networking
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Railway] Audio Engine & Healthcheck live on port ${PORT}`);
});

import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createClient } from '@base44/sdk';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// EXTERNAL SDK CONFIG: Fetching prompt/updating DB as Admin
const base44 = createClient({
  appId: process.env.BASE44_APP_ID,
  token: process.env.BASE44_ADMIN_TOKEN, // Your Admin API Key
});

wss.on('connection', async (ws, req) => {
  const params = new URLSearchParams(req.url.split('?')[1]);
  const campaignId = params.get('c');
  const leadId = params.get('l');

  console.log(`[Railway] New Call: Campaign ${campaignId}, Lead ${leadId}`);

  let dgWs = null;
  let streamSid = null;
  let callLogId = null;
  let fullTranscript = "";

  try {
    // 1. Fetch Campaign data from Base44 (Internal Fetch)
    const [campaign] = await base44.entities.Campaign.filter({ id: campaignId });
    const [lead] = await base44.entities.Lead.filter({ id: leadId });

    if (!campaign) throw new Error("Campaign record missing");

    ws.on('message', async (message) => {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        
        // Link to the CallLog record created by Base44
        const logs = await base44.entities.CallLog.filter({ twilio_call_sid: streamSid });
        if (logs[0]) {
          callLogId = logs[0].id;
          await base44.entities.CallLog.update(callLogId, { status: 'in_progress' });
        }

        // 2. Open Deepgram Voice Agent (Flux)
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
                provider: { type: campaign.llm_provider || 'open_ai', model: campaign.llm_model || 'gpt-4o-mini' },
                instructions: campaign.agent_prompt 
              },
              speak: { model: campaign.agent_voice || 'aura-2-thalia-en' }
            }
          }));
        });

        dgWs.on('message', async (data) => {
          // Audio Data -> Send to Twilio
          if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: data.toString('base64') }
            }));
          }

          // JSON Data -> Update Transcript & Handle Tools
          if (typeof data === 'string') {
            const response = JSON.parse(data);

            if (response.type === 'UtteranceEnd') {
              const text = response.channel.alternatives[0].transcript;
              const role = response.is_final ? "[agent]" : "[user]";
              fullTranscript += `${role} ${text}\n`;
              
              if (callLogId) {
                // Update live transcript in Base44
                base44.entities.CallLog.update(callLogId, { live_transcript: fullTranscript });
              }
            }

            // TOOL CALL: Book Appointment
            if (response.type === 'FunctionCall' && response.name === 'book_appointment') {
              await base44.entities.Appointment.create({
                lead_id: leadId,
                campaign_id: campaignId,
                lead_name: `${lead?.first_name || 'Lead'}`,
                lead_phone: lead?.phone || '',
                scheduled_date: response.parameters.date,
                scheduled_time: response.parameters.time,
                status: 'scheduled'
              });
              dgWs.send(JSON.stringify({ type: 'FunctionResponse', call_id: response.call_id, output: "Success" }));
            }
          }
        });
      }

      // Incoming audio from Twilio -> Send to Deepgram
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }
    });

    ws.on('close', async () => {
      if (dgWs) dgWs.close();
      if (callLogId) {
        await base44.entities.CallLog.update(callLogId, { 
          status: 'completed', 
          transcript: fullTranscript,
          ended_at: new Date().toISOString()
        });
      }
    });

  } catch (err) {
    console.error("Critical Failure:", err.message);
    ws.close();
  }
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log("Audio Engine Online"));

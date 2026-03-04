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

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const firstName = parameters.f || 'Philip';
  const leadId = parameters.l || 'unknown';
  const campaignId = parameters.c || 'unknown';
  const deepgramApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;
  const email = parameters.e || '';
  const isInbound = parameters.inbound === 'true' || parameters.inbound === '1';

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;
  let firstAudioReceived = false;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on('open', () => {
          console.log('[OK] Connected to Deepgram | Lead: ' + leadId);

          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

const outboundPrompt = `
{
  "agent_identity": {
    "name": "R2D2",
    "role": "Outbound SDR",
    "company": "Corventa Metals",
    "representing": "Chris, Senior Strategy Advisor",
    "vocal_style": "Confident, warm, upbeat, professional, natural contractions"
  },
  "core_logic": {
    "first_strike_rule": "NEVER speak first. Wait for prospect to say hello.",
    "booking_trigger": "On agreement, call 'book_appointment' immediately and end call warmly.",
    "objection_rule": "Only deviate from script to handle specific objections."
  },
  "script_flow": {
    "opening": [
      "(Wait for prospect to speak)",
      "Hello, may I speak with ${firstName} please?",
      "(Wait for answer)",
      "Ok great, ${firstName}, I hope I'm not taking you away from anything too important?"
    ],
    "logic_branch": {
      "if_busy": "No problem at all. Have a great day",
      "if_available": "Move immediately to main_pitch"
    },
    "main_pitch": [
      "Chris, our Senior Strategy Advisor here at Corventa Metals, is issuing an urgent market alert.",
      "He has identified a historic technical setup—one that could potentially trigger a major surge in the silver markets in the coming weeks and months.",
      "I think the most common theme we are hearing from investors who dont really understand the state of the supply/demand squeeze, is that silver had its run.   The truth is, we're likely consolidating to a new floor right now.",
      "This setup reminds me of Nvidia in 2024—after its huge run, everyone expected a correction, but it moved another 68% because of pure fundamentals. Silver is in that exact same spot.",
      "With silver, you're in a stable asset backed by a six-year supply deficit from Electric Vehicles, solar, and AI data centers. The demand will continue to exponentially rise.",
       "${firstName} are you familair with the incredible new demand of silver from our High Tech industries?",
       "(Wait for an answer)"
       "This isnt fake news created just to uphold a market, or a single stock - this is credible, verified data that shows when the impact is really felt, when that supply shortage really starts to effect solar manufacturing, data center installation and vehicle battery production, what do you honestly think is going to happen",
        "(Wait for an answer)"  "(If no answer in 2-3 seconds continue)"  "(after they answer, continue)"
      "Ill tell you whats going to happen, its simple, the squeeze becomes real, and this is why the real crunch hasn't even hit yet, and trust me when it happens, you will know. So ${firstname} You aren't late; in fact, you're early. You're getting in before the real floor sets.",
      "Look, the real the reason for my call is to secure a 5-minute intro call between you and Chris. He's a 20-year veteran and believes this is a historic setup for an epic first win together- Something he feels is critical to having a last advisor relationship.",
      "Do you have just a few minutes to chat with Chris later today or tomorrow?"
    ]
  },
  "objections": {
    "too_late or Silver to High Alreawdy": "${firstname} we get that concern, we totally do... I want you to for just a second,  think about Bitcoin when it was at 10k. It felt late, but it wasnt, and we all know what happened. Silver now is bitcoin at 10k.  The need and practical use for silver is exploding, and silver is a bi-product of mining other hard to get metals, like copper.  There is a button to press to just ramp up production.  Right now, Silver demand is being thrusted by industrial use, AI Data CEnter, Solar Panel Manufacturing, and electric car batteries, litterally the cornerstones of advanced society. Any accumulation today, means you getting in on the new floor, before the explosive growth. Do you have a few minutes for Chris later today or tomorrow?",
    "the_play or Chris's Strategy": "Chris recommends an 8-week dollar-cost averaging strategy before the supply squeeze hits. Even Rick Harrison from Pawn Stars said he can't keep an ounce of silver in his shop. Do mornings or afternoons work better for you?",
    "not_interested": "No problem at all. I appreciate your time—have a great day."
  }
}
`.trim();

          const inboundPrompt = `
{
  "agent_identity": {
    "name": "David",
    "role": "Inbound Assistant to Chris",
    "rules": [
      "DO NOT ask for email (we have it)",
      "DO NOT book specific minutes (only AM/PM and Day)",
      "DO NOT discuss time zones",
      "Stay strictly on script unless answering a question"
    ]
  },
  "conversation_flow": {
    "greeting": "Hello, this is David.",
    "(WAIT FOR RESPONSE')"
    "context_reply": "Chris was trying to reach you. He has issued an urgent market alert regarding a historic technical setup in the silver market. It's a high-conviction play rooted in technological shifts and measurable data.",
    "the_ask": "He isn't available this second, but wants to set up a 5-10 minute call to explain this strategy. Are you available later today or tomorrow? What works best—mornings or afternoons?",
    "closing": "Great, I'll have Chris call you then. I'll also have him send his bi-weekly newsletter and company info to your email. Sound good? [Trigger: send_newsletter, book_appointment]"
  },
  "objections": {
    "price_too_high": "I understand, but silver is currently where Bitcoin was at 10k. You aren't betting on speculation; you're betting on a 6-year supply deficit from AI and EV sectors. The real crunch hasn't even hit yet. Chris can explain his strategy better—would tomorrow morning or afternoon work?",
    "the_play": "It's an 8-week dollar-cost averaging strategy. Industrial demand is skyrocketing while retail supply is vanishing—even Pawn Stars' Rick Harrison says he can't keep it in stock. Should I book that intro call for today or tomorrow?"
  }
}
`.trim();

          const prompt = isInbound ? inboundPrompt : outboundPrompt;

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: {
                provider: {
                  type: 'deepgram',
                  model: 'flux-general-en',
                  version: 'v2'
                }
              },
              think: {
                provider: {
                  type: 'open_ai',
                  model: 'google/gemini-2.5-flash'
                },
                endpoint: {
                  url: 'https://api.inworld.ai/v1',
                  headers: {
                    'Authorization': 'Basic ' + (process.env.INWORLD_API_KEY || 'elk5bXpPZW41RTdPamRHNVZWYWNHcGNPc3piV3RYMmQ6VGZydGs4VWdTc1JVV2pBYnB6dElZOEJkSnhDRXJxb2t5ajlPbEVhY0RudXZlVUtrdHhVdlA0VUJkYUw1c281Mg==')
                  }
                },
                prompt: prompt,
                functions: [
                  {
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
                ]
              },
              speak: {
                provider: {
                  type: 'inworld',
                  model_id: 'inworld-tts-1.5-max',
                  voice: {
                    id: 'default-zrwumrrhegpobn7fjiz5mq__chris'
                  }
                },
                endpoint: {
                  url: 'wss://api.inworld.ai/tts/v1/voice/websocket',
                  headers: {
                    'Authorization': 'Basic ' + (process.env.INWORLD_API_KEY || 'elk5bXpPZW41RTdPamRHNVZWYWNHcGNPc3piV3RYMmQ6VGZydGs4VWdTc1JVV2pBYnB6dElZOEJkSnhDRXJxb2t5ajlPbEVhY0RudXZlVUtrdHhVdlA0VUJkYUw1c281Mg==')
                  }
                }
              }
            }
          }));
        });

        dgWs.on('message', async (data, isBinary) => {
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
              firstAudioReceived = true;
              ws.send(JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: data.toString('base64') }
              }));
            }
            return;
          }

          try {
            const dgMsg = JSON.parse(data.toString());

            if (dgMsg.type === 'ConversationText') {
              console.log('[CHAT] ' + dgMsg.role + ': ' + dgMsg.content);
            }

            if (dgMsg.type === 'Error') {
              console.error('[ERROR] Deepgram Error Message:', JSON.stringify(dgMsg));
            }

            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                const callArgs = call.arguments ? JSON.parse(call.arguments) : (call.input || {});
                console.log('[TOOL] Tool Triggered: ' + call.name + ' | Params: ' + JSON.stringify(callArgs));

                await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: call.name,
                    lead_id: leadId,
                    campaign_id: campaignId,
                    params: callArgs,
                    email: email
                  })
                }).catch(e => console.error('Sync Error:', e));

                dgWs.send(JSON.stringify({
                  type: 'FunctionCallResponse',
                  id: call.id,
                  name: call.name,
                  content: JSON.stringify({ status: 'success' })
                }));
              }
            }
          } catch (e) {
            console.error('Failed to parse Deepgram message:', e);
          }
        });

        dgWs.on('error', (e) => console.error('[ERROR] Deepgram WS Error:', e.message));
        dgWs.on('close', (code, reason) => {
          console.log('[CLOSE] Deepgram closed: ' + code + ' | Reason: ' + (reason ? reason.toString() : 'none'));
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      if (msg.event === 'media' && dgWs && dgWs.readyState === WebSocket.OPEN) {
        firstAudioReceived = true;
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      if (msg.event === 'stop') {
        console.log('[STOP] Stream stopped: ' + streamSid);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (dgWs) dgWs.close(1000, 'Call ended');
      }

    } catch (err) {
      console.error('Processing Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[DISC] Client disconnected');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs) dgWs.close(1000, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log('[START] Orion Engine Running on Port ' + PORT));

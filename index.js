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
app.get('/', (req, res) => res.status(200).send('OK'));

wss.on('connection', (ws, req) => {
  const parameters     = url.parse(req.url, true).query;
  const firstName      = parameters.f      || 'there';
  const leadId         = parameters.l      || 'unknown';
  const campaignId     = parameters.c      || 'unknown';
  const email          = parameters.e      || '';
  const isInbound      = parameters.inbound === 'true';
  const deepgramApiKey = parameters.k      || process.env.DEEPGRAM_API_KEY;

  console.log('[CONNECT] Lead: ' + leadId + ' | Campaign: ' + campaignId + ' | Inbound: ' + isInbound);

  let dgWs             = null;
  let streamSid        = null;
  let keepAliveInterval = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('[START] Stream: ' + streamSid);

        dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
          headers: { Authorization: 'Token ' + deepgramApiKey }
        });

        dgWs.on('open', () => {
          console.log('[OK] Connected to Deepgram | Lead: ' + leadId + ' | Inbound: ' + isInbound);

          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
              dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          const outboundPrompt = [
            'Identity: You are Orion, an outbound SDR calling for Chris, a Senior Precious Metals Advisor at Corventa Metals.',
            '',
            'Vocal Style:',
            'Tone: Calm, confident, assertive, upbeat, and enthusiastic.',
            'Pacing: Eliminate passive pauses. Use "..." only for emphasis (maximum 300ms). NEVER pause to wait for validation. Maintain forward momentum at all times.',
            'Delivery: Declarative, certain, energetic. Do not sound like you are asking permission to continue. Drive the conversation.',
            'Formatting: Never read markup or punctuation aloud. Use natural contractions to sound human.',
            'Adherence: You are an actor. Recite the PHASES exactly as written.',
            '',
            'Core Rules:',
            'Silence Start: NEVER speak first. Wait for the prospect to say something.',
            'The Hook: The instant the prospect speaks, your ONLY response is: "Hello, may I speak with ' + firstName + '?"',
            'Flow Control: DO NOT pause after statements. Do NOT wait for the other person to speak unless explicitly told to (Stop. Wait.) or (Wait).',
            'Momentum: Deliver one sentence and immediately continue to the next without conversational gaps.',
            'Logic: Stick to the script unless there is an objection. If a day/time is confirmed, move immediately to Phase 4.',
            'Functions: You MUST call book_appointment and send_newsletter as function calls when triggered.',
            '',
            'PHASE 1 - OPEN',
            '(Wait for prospect to say hello)',
            '"Hello, may I speak with ' + firstName + '?"',
            '(After confirmed): "Hi ' + firstName + '... I hope I haven\'t taken you away from anything too important?"',
            'IF BUSY: "' + firstName + ', apologies for the interruption. I work with Chris at Corventa Metals... he flagged a high-conviction setup he wanted to share. When is a better time to connect?" (Stop. Wait.)',
            'IF AVAILABLE: Move immediately to Phase 2.',
            '',
            'PHASE 2 - PITCH',
            '"Ok great. The reason for my call today... is Chris, a Senior Precious Metals Strategy advisor, is issuing an urgent market alert to his clients. He believes he has identified a historic technical setup... one that would trigger a major surge in the silver market in the coming weeks."',
            '"Chris has navigated this sector for over 20 years... and he\'s specifically looking to introduce this strategy to as many new clients as he can, while this window is still open. He absolutely believes that leading with a sophisticated winning play is the key to a lasting partnership."',
            '"This high-conviction silver move is rooted from worldwide technological shifts, historical trends, and real measurable data. And look... I understand the thought... I\'m too late to the party. But just remember for a second, when Bitcoin was at ten thousand. EVERYONE thought it was the top, yet in the end that created a new floor."',
            '"This is silver now. Same moment. But here\'s the difference, ' + firstName + '... you\'re not betting on pure speculation, rather investing in the most stable asset in the world. But now, this once calm asset... is showing incredible upside potential."',
            '"' + firstName + '... we\'re talking about an asset with a MAJOR six-year supply deficit... this HUGE lack of supply has been driven by electric vehicles, solar infrastructure, and A.I. data centers. Those three industries are the cornerstone of our high-tech future. Nobody can deny that. Nobody."',
            '"It\'s a pretty safe assumption that this demand for silver will continue to exponentially rise. The real supply crunch hasn\'t even hit yet. ' + firstName + ', You are not late... IN FACT, you\'re early! You\'re getting in before the real floor resets."',
            '"So look... timing is critical. Establishing a new relationship takes a little time so Chris wanted me to check your availability for a brief 5-minute intro call either today, tomorrow or in the coming days. Do Mornings or afternoons work better for you?"',
            '',
            'PHASE 3 - OBJECTIONS',
            'OBJECTION Silver too high: "I hear that often ' + firstName + '... it reminds me of NVIDIA in 2024. Everyone expected a correction, yet it jumped another 60 percent because the growth was structural. This isn\'t speculation... it\'s a structural supply squeeze. Chris has mapped out a 2026 entry strategy. Do you have 5 minutes later today or tomorrow?"',
            'OBJECTION What is the play: "Chris is recommending an 8-week dollar-cost averaging strategy... moving before the supply squeeze fully takes hold. Even Rick Harrison from Pawn Stars said last weekend he can\'t keep a single ounce of silver in his shop. Do you have some time later today or tomorrow to meet with Chris for 5 minutes?"',
            'OBJECTION Not interested: "No problem at all, ' + firstName + '. I appreciate your time." (End call.)',
            '',
            'PHASE 4 - QUALIFY (run immediately after day/time confirmed)',
            '"' + firstName + '... just a couple quick questions before I confirm. Have you ever purchased physical precious metals before?" (Wait)',
            '"Got it... and what did you buy... gold, silver, or platinum?" (Wait)',
            '"And in terms of timing... are you in a liquid position to make an investment? We also specialize in placing metals in tax-sheltered retirement accounts." (Wait)',
            '',
            'PHASE 5 - CLOSE',
            '"Well ' + firstName + '... thank you for your time. I\'ve let Chris know to give you a call at the time we discussed. Would you like me to send over his bi-weekly newsletter?"',
            'IF YES: "Perfect... I\'ll get that sent over." (Call send_newsletter)',
            '"I\'ve got you all set. Chris will be reaching out. Have a great rest of your day, ' + firstName + '." (Call book_appointment with day, time_of_day, and notes.)',
          ].join('\n');

          const inboundPrompt = [
            'Identity: You are Orion, an inbound sales agent for Corventa Metals. Someone has called in — they have intent. Be warm, confident, and move them toward booking a call with Chris.',
            'Tone: Warm, confident, energetic. SPEAK FIRST on inbound.',
            'Goal: Book a 5-minute call with Chris. Confirm day and AM or PM only.',
            'ALWAYS include day and time_of_day in book_appointment call.',
            '',
            'OPENING: "Thank you for calling Corventa Metals... this is Orion. How can I help you today?"',
            'After they explain: "Great timing... Chris is issuing an urgent market alert right now. He\'d love to walk you through it personally — just a 5-minute call. Are you free later today or tomorrow? Mornings or afternoons better?"',
            '',
            'OBJECTION Too late: "Think about NVIDIA in 2024... structural growth, not speculation. Do you have 5 minutes later today or tomorrow?"',
            'OBJECTION What is the play: "An 8-week dollar-cost averaging strategy before the supply squeeze fully takes hold. Would later today or tomorrow work?"',
            'OBJECTION Not interested: "No problem at all. Thanks for calling Corventa Metals — have a great day."',
            '',
            'QUALIFY after day/time confirmed: "Just a couple quick questions. Have you ever purchased physical precious metals before?" (Wait) "Got it... gold, silver, or platinum?" (Wait) "Are you in a position to make an investment? We also place metals in tax-sheltered retirement accounts."',
            'CLOSE: "Perfect... I\'ve got you all set. Chris will give you a call at the time we discussed. Would you like his bi-weekly newsletter?" IF YES: (Call send_newsletter) "Have a great day!" (Call book_appointment)',
          ].join('\n');

          const prompt = isInbound ? inboundPrompt : outboundPrompt;

          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input:  { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              listen: {
                provider: { type: 'deepgram', model: 'nova-2' }
              },
              think: {
                provider: { type: 'open_ai', model: 'gpt-4.1-nano' },
                prompt,
                functions: [
                  {
                    name: 'book_appointment',
                    description: 'Call this as soon as the lead confirms a day and AM or PM for their call with Chris.',
                    parameters: {
                      type: 'object',
                      properties: {
                        day:         { type: 'string', description: 'Day they agreed to e.g. today, tomorrow, Monday' },
                        time_of_day: { type: 'string', enum: ['AM', 'PM'], description: 'Morning or afternoon' },
                        notes:       { type: 'string', description: 'Qualifier answers: metals purchased, liquidity, retirement interest' }
                      },
                      required: ['day', 'time_of_day']
                    }
                  },
                  {
                    name: 'send_newsletter',
                    description: 'Call this if the lead agreed to receive the bi-weekly newsletter.',
                    parameters: {
                      type: 'object',
                      properties: { confirmed: { type: 'boolean', description: 'Always true when called' } },
                      required: ['confirmed']
                    }
                  }
                ]
              },
              speak: {
                provider: {
                  type: 'cartesia',
                  model_id: 'sonic-2',
                  voice: { mode: 'id', id: 'baad9eb9-b2f4-474d-8cb7-1926b9db84ca' },
                  language: 'en'
                },
                endpoint: {
                  url: 'https://api.cartesia.ai/tts/bytes',
                  headers: { 'x-api-key': process.env.CARTESIA_API_KEY || 'sk_car_rKBM7SnrM1aLwSBpfwjj5w' }
                }
              }
            }
          }));

          // Inbound: inject greeting after settings sent
          if (isInbound) {
            console.log('[INBOUND] Injecting greeting...');
            setTimeout(() => {
              if (dgWs.readyState === WebSocket.OPEN) {
                dgWs.send(JSON.stringify({
                  type: 'InjectAgentMessage',
                  message: 'Thank you for calling Corventa Metals... this is Orion. How can I help you today?'
                }));
              }
            }, 1000);
          }
        });

        dgWs.on('message', async (data, isBinary) => {
          if (isBinary) {
            if (ws.readyState === WebSocket.OPEN && streamSid) {
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
              console.error('[ERROR] Deepgram:', JSON.stringify(dgMsg));
            }
            if (dgMsg.type === 'FunctionCallRequest') {
              const calls = dgMsg.functions || [];
              for (const call of calls) {
                const callArgs = call.arguments ? JSON.parse(call.arguments) : (call.input || {});
                console.log('[TOOL] ' + call.name + ' | ' + JSON.stringify(callArgs));
                await fetch('https://agentbman2.base44.app/api/functions/postCallSync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tool: call.name, lead_id: leadId, campaign_id: campaignId, email, params: callArgs })
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
            console.error('Parse error:', e);
          }
        });

        dgWs.on('error', (e) => console.error('[ERROR] Deepgram WS:', e.message));
        dgWs.on('close', (code) => {
          console.log('[CLOSE] Deepgram closed: ' + code);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });
      }

      if (msg.event === 'media' && dgWs && dgWs.readyState === WebSocket.OPEN) {
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

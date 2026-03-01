import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import url from 'url';
import fetch from 'node-fetch'; // Ensure 'node-fetch' is in your package.json

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => res.status(200).send('ok'));

wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true).query;
  const campaignId = parameters.c || 'test_campaign';
  const leadId = parameters.l || 'test_lead';

  console.log(`🚀 Twilio Connected! Campaign: ${campaignId} | Lead: ${leadId}`);

  let dgWs = null;
  let streamSid = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log(`Stream started: ${streamSid}`);

        // 1. WebSocket connection using Header Auth (Fixes 401 Unauthorized)
        dgWs = new WebSocket('wss://api.deepgram.com/v1/agent/converse', {
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`
          }
        });

        dgWs.on('open', () => {
          console.log("✅ Deepgram Authenticated & Connected!");
          
          // 2. Initial Settings with the 'Chris' SDR Persona & Tools
          dgWs.send(JSON.stringify({
            type: 'Settings',
            audio: {
              input: { encoding: 'mulaw', sample_rate: 8000 },
              output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' }
            },
            agent: {
              think: { 
                provider: { type: 'open_ai', model: 'gpt-4o-mini' }, 
                prompt: `
                  # ROLE
                  You are a professional, high-conviction Sales Development Representative working for Chris, a Senior Precious Metals Advisor at Corventa Metals. Chris has 20 years of experience.
                  
                  # SCRIPT FLOW
                  - Hook: "Hello, may I speak with [Lead Name]? ... Hi, I hope I haven’t taken you away from anything too important?"
                  - Reason: Chris has a high-conviction play in silver. It's rooted in tangible data, not speculation.
                  - The Soft Ask: "He wanted me to reach out and see if you could squeeze in 5-10 minutes tomorrow or the next day so he can share his strategy?"

                  # OBJECTION HANDLING: "Silver is at the top"
                  - Use the Bitcoin Comparison: "Remember when Bitcoin hit $10k and everyone thought it was the top? This is similar. It's about utility."
                  - Data: Mention the structural supply squeeze from AI data centers and solar. Miners can't keep up.
                  - Social Proof: Mention the Fox News interview with Rick Harrison (Pawn Stars) confirming the shortage.

                  # TOOLS & CLOSING
                  - If they agree to a time: Call 'mark_as_qualified' and say "Perfect, Chris will reach out then. Have a great day!"
                  - If they want the data/video: Call 'send_newsletter' and say "I'm texting that Rick Harrison interview over now."
                  - After a tool is called or the lead says goodbye, end the call.
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Call this when the lead agrees to a callback window with Chris.",
                    parameters: {
                      type: "object",
                      properties: {
                        window: { type: "string", description: "The agreed time window, e.g., 'tomorrow afternoon'" }
                      }
                    }
                  },
                  {
                    name: "send_newsletter",
                    description: "Call this if the lead wants the Rick Harrison video or the newsletter."
                  }
                ]
              },
              speak: { 
                provider: { type: 'deepgram', model: 'aura-2-thalia-en' } 
              }
            }
          }));
        });

        dgWs.on('message', async (data) => {
          const response = JSON.parse(data.toString());

          // 3. Handle Binary Audio from AI to Twilio
          if (Buffer.isBuffer(data) && ws.readyState === WebSocket.OPEN && streamSid) {
            ws.send(JSON.stringify({ 
              event: 'media', 
              streamSid, 
              media: { payload: data.toString('base64') } 
            }));
          }

          // 4. Handle Function Calls (Pipedrive / SMS Sync)
          if (response.type === 'FunctionCallRequest') {
            // Extracting from the first function in the array per V1 spec
            const toolCall = response.functions[0];
            console.log(`🛠️ Tool Triggered: ${toolCall.name}`, toolCall.arguments);

            // Notify Base44 to update Pipedrive/Trigger SMS
            try {
              fetch(`https://agentbman2.base44.app/api/functions/postCallSync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tool: toolCall.name,
                  campaign_id: campaignId,
                  lead_id: leadId,
                  arguments: toolCall.arguments
                })
              });
            } catch (e) {
              console.error("Base44 Sync Failed:", e.message);
            }

            // Acknowledge the function to Deepgram
            dgWs.send(JSON.stringify({
              type: 'FunctionCallResponse',
              id: toolCall.id,
              name: toolCall.name,
              content: "{\"status\": \"success\"}"
            }));
          }
        });

        dgWs.on('error', (err) => console.error("❌ Deepgram Error:", err.message));
      }

      // 5. Forward human audio to Deepgram
      if (msg.event === 'media' && dgWs?.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }

    } catch (e) {
      console.error("Stream processing error:", e);
    }
  });

  ws.on('close', () => {
    console.log(`📴 Call Ended for Lead: ${leadId}`);
    dgWs?.close();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Engine live on ${PORT}`));

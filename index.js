import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Orion Engine Running");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const params = Object.fromEntries(url.searchParams.entries());

  const leadId = params.l;
  const firstName = params.f || "there";
  const email = params.e || "";
  const callLogId = params.log;
  const isInbound = params.inbound === "true";

  let fullTranscript = "";
  const callStart = Date.now();

  const inboundPrompt = `
You are Orion returning a missed call.
Speak naturally and concisely.
Book using only DAY and AM/PM.
Do not ask for email.
End call immediately after booking.
`;

  const outboundPrompt = `
You are Orion calling ${firstName}.
Speak naturally and concisely.
Book using only DAY and AM/PM.
Do not ask for email.
End call immediately after booking.
`;

  const dgWs = new WebSocket("wss://agent.deepgram.com/v1/agent", {
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`
    }
  });

  dgWs.on("open", () => {
    dgWs.send(JSON.stringify({
      type: "Settings",
      audio: {
        input: { encoding: "mulaw", sample_rate: 8000 },
        output: { encoding: "mulaw", sample_rate: 8000 }
      },
      agent: {
        listen: {
          provider: { type: "deepgram", model: "flux-general-en" }
        },
        think: {
          provider: { type: "open_ai", model: "gpt-4.1-nano" },
          prompt: isInbound ? inboundPrompt : outboundPrompt,
          tools: [
            {
              name: "book_appointment",
              description: "Create CRM appointment",
              parameters: {
                type: "object",
                properties: {
                  day: { type: "string" },
                  time_of_day: { type: "string", enum: ["AM", "PM"] }
                },
                required: ["day", "time_of_day"]
              }
            },
            {
              name: "mark_email_requested",
              description: "Mark lead requested email",
              parameters: {
                type: "object",
                properties: {}
              }
            },
            {
              name: "update_lead_notes",
              description: "Append note to lead",
              parameters: {
                type: "object",
                properties: {
                  note: { type: "string" }
                },
                required: ["note"]
              }
            }
          ]
        },
        speak: isInbound
          ? {
              provider: { type: "deepgram", model: "aura-2-thalia-en" }
            }
          : {
              provider: {
                type: "cartesia",
                model_id: "sonic-2",
                voice: {
                  mode: "id",
                  id: process.env.CARTESIA_VOICE_ID
                }
              },
              endpoint: {
                url: "https://api.cartesia.ai/tts/bytes",
                headers: {
                  "x-api-key": process.env.CARTESIA_API_KEY
                }
              }
            }
      }
    }));

    if (isInbound) {
      dgWs.send(JSON.stringify({
        type: "UserText",
        text: "Begin the call."
      }));
    }
  });

  // Receive audio from Twilio → send to Deepgram
  ws.on("message", message => {
    const data = JSON.parse(message);

    if (data.event === "media") {
      dgWs.send(JSON.stringify({
        type: "Audio",
        audio: data.media.payload
      }));
    }
  });

  // Receive AI responses from Deepgram
  dgWs.on("message", async message => {
    const data = JSON.parse(message);

    // Stream audio back to Twilio
    if (data.type === "Audio") {
      ws.send(JSON.stringify({
        event: "media",
        media: { payload: data.audio }
      }));
    }

    // Capture transcript
    if (data.type === "ConversationText") {
      fullTranscript += `\n${data.role}: ${data.content}`;
    }

    // Tool Calls
    if (data.type === "ToolCall") {
      const tool = data.name;
      const args = data.arguments;

      if (tool === "book_appointment") {
        await fetch(`${process.env.BASE44_API_URL}/entities/Appointment`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.BASE44_SERVICE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            lead_id: leadId,
            scheduled_date: new Date().toISOString(),
            time_of_day: args.time_of_day,
            status: "scheduled",
            notes: `Booked via AI (${args.day} ${args.time_of_day})`
          })
        });
      }

      if (tool === "mark_email_requested") {
        await fetch(`${process.env.BASE44_API_URL}/entities/Lead/${leadId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.BASE44_SERVICE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            notes: "email_requested"
          })
        });
      }

      if (tool === "update_lead_notes") {
        await fetch(`${process.env.BASE44_API_URL}/entities/Lead/${leadId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.BASE44_SERVICE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            notes: args.note
          })
        });
      }
    }
  });

  // When call ends
  ws.on("close", async () => {
    const duration = Math.floor((Date.now() - callStart) / 1000);

    if (callLogId) {
      await fetch(`${process.env.BASE44_API_URL}/entities/CallLog/${callLogId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.BASE44_SERVICE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: "completed",
          duration_seconds: duration,
          transcript: fullTranscript
        })
      });
    }

    dgWs.close();
  });
});

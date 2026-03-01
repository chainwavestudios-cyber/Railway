import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import url from "url";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* -------------------------------------------------------
   GLOBAL ERROR HANDLERS
------------------------------------------------------- */
process.on("uncaughtException", (err) => console.error("🔥 UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("⚠️ UNHANDLED REJECTION:", reason));

/* -------------------------------------------------------
   HEALTH CHECK
------------------------------------------------------- */
app.get("/health", (req, res) => res.status(200).send("Orion Engine Live"));

/* -------------------------------------------------------
   MAIN WEBSOCKET SERVER
------------------------------------------------------- */
wss.on("connection", (clientWs, req) => {
  const params = url.parse(req.url, true).query;
  const firstName = params.f || "there";
  const leadId = params.l || "unknown";
  const campaignId = params.c || "unknown";
  const deepgramApiKey = params.k || process.env.DEEPGRAM_API_KEY;

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;

  clientWs.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);

      /* -----------------------------
         START EVENT
      ----------------------------- */
      if (msg.event === "start") {
        streamSid = msg.start.streamSid;

        dgWs = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", {
          headers: { Authorization: `Token ${deepgramApiKey}` },
        });

        dgWs.on("error", (e) => console.error("❌ Deepgram Error:", e.message));

        dgWs.on("close", (code, reason) => {
          console.log(`🔌 Deepgram closed: ${code}`, reason?.toString());
          if (keepAliveInterval) clearInterval(keepAliveInterval);
        });

        dgWs.on("open", () => {
          console.log("✅ Connected to Deepgram");

          // Keep connection alive
          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) dgWs.send(JSON.stringify({ type: "KeepAlive" }));
          }, 5000);

          // Send tiny silent audio chunk immediately to initialize session
          const silence = Buffer.alloc(320, 0); // ~20ms at 8kHz mulaw
          dgWs.send(silence);

          // Configure Deepgram agent
          dgWs.send(JSON.stringify({
            type: "Settings",
            audio: {
              input: { encoding: "mulaw", sample_rate: 8000 },
              output: { encoding: "mulaw", sample_rate: 8000, container: "none" },
            },
            agent: {
              listen: { provider: { type: "deepgram", model: "flux-general-en" } },
              think: {
                provider: { type: "anthropic", model: "claude-4-5-haiku-20241022" },
                instructions: `
You are Orion, a disciplined SDR calling for Chris, a Senior Precious Metals advisor at Corventa Metals.

ABSOLUTE RULES:
1. Wait for prospect to speak first.
2. Stay strictly on script.
3. Only deviate for direct objections/questions.
4. After answering, immediately return to script.
5. Goal: book a call.
6. Only confirm DAY and AM/PM.
7. PRIORITY: same-day or next-day.
8. Do not over-talk or over-explain.
9. Do not confirm email unless prospect offers it.
10. Once booked, call function mark_as_qualified.

FULL SCRIPT FLOW:
Phase 1 – OPEN: Greeting, check if busy.
Phase 2 – AUTHORITY: Chris’ experience & silver play.
Phase 3 – OBJECTIONS: Handle silver price or "play" questions.
Phase 4 – QUALIFICATION: Ask prior metals purchases & portfolio liquidity.
Phase 5 – CLOSE: Confirm day/AM-PM, offer newsletter, mark_as_qualified.

SCHEDULING:
Extract: day, AM/PM, send_email true/false, notes.
Book only when agreement is clear.
                `,
                functions: [
                  {
                    name: "mark_as_qualified",
                    description: "Lead agreed to a scheduled call with Chris",
                    parameters: {
                      type: "object",
                      properties: {
                        day: { type: "string" },
                        time_of_day: { type: "string", enum: ["AM", "PM"] },
                        send_email: { type: "boolean" },
                        notes: { type: "string" },
                      },
                      required: ["day", "time_of_day", "send_email"],
                    },
                  },
                ],
              },
              speak: { provider: { type: "cartesia", model: "sonic-english" } },
            },
          }));
        });

        /* -----------------------------
           HANDLE DEEPGRAM RESPONSES
        ----------------------------- */
        dgWs.on("message", async (data, isBinary) => {
          if (isBinary) {
            if (clientWs.readyState === WebSocket.OPEN && streamSid) {
              clientWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: data.toString("base64") } }));
            }
            return;
          }

          const dgMsg = JSON.parse(data.toString());

          if (dgMsg.type === "ConversationText") console.log(`💬 ${dgMsg.role}: ${dgMsg.content}`);

          if (dgMsg.type === "FunctionCallRequest") {
            const call = dgMsg.functions[0];
            const details = call.arguments;

            console.log(`📅 Booking: ${firstName}`, details);

            try {
              await fetch("https://agentbman2.base44.app/api/functions/postCallSync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "CREATE_APPOINTMENT",
                  lead_name: firstName,
                  lead_id: leadId,
                  campaign_id: campaignId,
                  appointment: {
                    day: details.day,
                    time_of_day: details.time_of_day,
                    tags: ["lead_qualified", details.send_email ? "send_email" : null].filter(Boolean),
                    notes: details.notes || "",
                  },
                }),
              });
            } catch (err) { console.error("Sync Error:", err); }

            dgWs.send(JSON.stringify({
              type: "FunctionCallResponse",
              id: call.id,
              name: call.name,
              content: JSON.stringify({ status: "success" }),
            }));
          }
        });
      }

      /* -----------------------------
         MEDIA STREAMING
      ----------------------------- */
      if (msg.event === "media" && dgWs?.readyState === WebSocket.OPEN) {
        const audioBuffer = Buffer.from(msg.media.payload, "base64");
        if (audioBuffer.length > 0) dgWs.send(audioBuffer);
      }

      /* -----------------------------
         STOP EVENT
      ----------------------------- */
      if (msg.event === "stop") {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000);
      }

    } catch (err) {
      console.error("Processing Error:", err);
    }
  });

  clientWs.on("close", () => {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (dgWs?.readyState === WebSocket.OPEN) dgWs.close(1000);
  });
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Orion Engine Running on Port ${PORT}`));

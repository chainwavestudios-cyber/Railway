import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import url from "url";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* -------------------------------------------------------
   GLOBAL SAFETY HANDLERS
------------------------------------------------------- */
process.on("uncaughtException", (err) => console.error("🔥 CRITICAL ERROR:", err));
process.on("unhandledRejection", (reason) => console.error("⚠️ UNHANDLED REJECTION:", reason));

/* -------------------------------------------------------
   HEALTH CHECK
------------------------------------------------------- */
app.get("/health", (req, res) => res.status(200).send("Orion Engine Live"));

/* -------------------------------------------------------
   MAIN WEBSOCKET SERVER
------------------------------------------------------- */
wss.on("connection", (clientWs, req) => {
  const parameters = url.parse(req.url, true).query;

  const firstName = parameters.f || "there";
  const leadId = parameters.l || "unknown";
  const campaignId = parameters.c || "unknown";
  const deepgramApiKey = parameters.k || process.env.DEEPGRAM_API_KEY;

  let dgWs = null;
  let streamSid = null;
  let keepAliveInterval = null;

  clientWs.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);

      /* -----------------------------
         CALL START EVENT
      ----------------------------- */
      if (msg.event === "start") {
        streamSid = msg.start.streamSid;

        dgWs = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", {
          headers: { Authorization: `Token ${deepgramApiKey}` }
        });

        dgWs.on("open", () => {
          console.log(`✅ Connected to Deepgram for ${leadId}`);

          // Keep connection alive
          keepAliveInterval = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) dgWs.send(JSON.stringify({ type: "KeepAlive" }));
          }, 5000);

          // Send a tiny silent frame immediately to avoid 1005 closes
          const silent = Buffer.from([0xFF]);
          dgWs.send(silent);

          /* -------------------------------------------------------
             DEEPGRAM SETTINGS + FULL SCRIPT
          ------------------------------------------------------- */
          dgWs.send(JSON.stringify({
            type: "Settings",
            audio: {
              input: { encoding: "mulaw", sample_rate: 8000 },
              output: { encoding: "mulaw", sample_rate: 8000, container: "none" }
            },
            agent: {
              listen: { provider: { type: "deepgram", model: "flux-general-en" } },
              think: {
                provider: { type: "anthropic", model: "claude-4-5-haiku-20241022" },
                prompt: {
                  instructions: `
You are Orion, a disciplined SDR calling for Chris, a Senior Precious Metals advisor at Corventa Metals.

====================================================
ABSOLUTE RULES
====================================================
1. DO NOT speak first. Wait for the prospect to say hello.
2. Stay strictly on script.
3. Only deviate if:
   - Direct question
   - Direct objection
4. After answering, IMMEDIATELY return to script.
5. Your ONLY goal: book a call.
6. Only confirm:
   - DAY
   - AM or PM
7. PRIORITY: same day or next day.
8. Do NOT over-talk.
9. Do NOT explain deeply.
10. Do NOT confirm email unless they bring it up.
11. Once booked, call function mark_as_qualified.

====================================================
PHASE 1 – OPEN
====================================================
After they speak:
Say:
"Hello, may I speak with ${firstName}?"
After confirmation:
"Hi ${firstName}, I hope I haven’t taken you away from anything too important?"
If busy:
"${firstName}, please excuse the timing. I work with Chris at Corventa Metals, and he asked me to reach out regarding a specific technical setup in the metals market that he doesn’t want you to miss. Since I caught you in the middle of something, when would be a better window to give you a quick 2-minute update?"

====================================================
PHASE 2 – AUTHORITY BUILDER
====================================================
"The reason for my call is I work for a Senior Precious Metals advisor named Chris over at Corventa Metals.
Chris has over 20 years of experience in these markets, and right now he’s using every outlet he has to meet new people."
"He believes a financial relationship must begin with a true winning play.
Right now, he has a high-conviction move in silver rooted in tangible, measurable data."
"Timing is critical — so he wanted me to see if you could squeeze in 5 to 10 minutes in the next day or so to hear his thoughts."

====================================================
PHASE 3 – OBJECTIONS
====================================================
If silver price objection:
"I totally get that — it’s had a strong run. But remember when Bitcoin hit 10,000? Everyone thought that was the top.
The difference here is utility and consolidation.
We're seeing institutional buying and a structural supply squeeze driven by AI data centers, solar energy, and electric vehicles.
Demand is growing faster than production.
Chris simply wants to show you why this high might actually be the floor."
Then return to:
"Would tomorrow morning or afternoon work better?"
If they ask:
"What’s the play exactly?"
Say ONE sentence only:
"It’s a structural silver supply squeeze — sixth straight deficit year, with AI and solar demand accelerating faster than mining output."
Then:
"That’s exactly what Chris can explain in 10 minutes. Would today PM or tomorrow AM be better?"
If not interested:
"No problem at all, ${firstName}. I appreciate your time."

====================================================
PHASE 4 – AFTER AGREEMENT
====================================================
Once they agree to a DAY and AM/PM:
"${firstName}, I just need to ask a couple quick questions before I confirm."
1) "Have you ever purchased physical precious metals before?"
If yes, ask: "What did you buy — gold, silver, platinum?"
2) "In terms of timing, do you have liquid capital ready for a metals move, or flexibility in your portfolio? We also specialize in retirement accounts."

====================================================
PHASE 5 – CLOSE
====================================================
"Thanks for that information, ${firstName}. I’ve let Chris know to give you a call."
"In the meantime, would you like me to send over his bi-weekly newsletter?"
If yes:
"Perfect, I’ll get that sent over."
Then call function mark_as_qualified.

====================================================
SCHEDULING LOGIC
====================================================
Extract:
- day
- AM or PM
- send_email true/false
- notes including:
  - prior metals owned
  - IRA interest
  - liquidity comments
Only book when clear agreement exists.
`
                }
              },
              speak: { provider: { type: "cartesia" }, model: "sonic-english" },
            },
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
                    notes: { type: "string" }
                  },
                  required: ["day", "time_of_day", "send_email"]
                }
              }
            ]
          }));
        });

        /* -----------------------------
           HANDLE DEEPGRAM RESPONSES
        ----------------------------- */
        dgWs.on("message", async (data, isBinary) => {
          if (isBinary) {
            if (clientWs.readyState === WebSocket.OPEN && streamSid) {
              clientWs.send(JSON.stringify({
                event: "media",
                streamSid,
                media: { payload: data.toString("base64") }
              }));
            }
            return;
          }

          try {
            const dgMsg = JSON.parse(data.toString());
            if (dgMsg.type === "ConversationText") console.log(`💬 ${dgMsg.role}: ${dgMsg.content}`);

            if (dgMsg.type === "FunctionCallRequest") {
              const call = dgMsg.functions[0];
              const details = call.arguments;

              console.log(`📅 Booking: ${firstName}`, details);

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
                    notes: details.notes || ""
                  }
                })
              }).catch(e => console.error("Sync Error:", e));

              dgWs.send(JSON.stringify({ type: "FunctionCallResponse", id: call.id, name: call.name, content: JSON.stringify({ status: "success" }) }));
            }
          } catch (err) { console.error("DG Processing Error:", err); }
        });

        dgWs.on("error", (e) => console.error("❌ Deepgram Error:", e.message));
        dgWs.on("close", (code, reason) => {
          console.log(`🔌 Deepgram closed: ${code}`, reason || "");
          if (keepAliveInterval) clearInterval(keepAliveInterval);
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
        dgWs?.close(1000, "Call ended");
      }

    } catch (err) { console.error("Processing Error:", err); }
  });

  clientWs.on("close", () => {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    dgWs?.close(1000, "Client disconnected");
  });
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Orion Engine Running on Port ${PORT}`));

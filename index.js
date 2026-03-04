Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1. Try to get params from the Query String first
  let c = url.searchParams.get("c");
  let l = url.searchParams.get("l");
  let f = url.searchParams.get("f");
  let e = url.searchParams.get("e");

  // 2. If it's a POST and params are missing, they might be in the Body
  if (req.method === "POST" && (!c || !l)) {
    try {
      const body = await req.text();
      console.log(`📡 POST Body: ${body}`);
      const formData = new URLSearchParams(body);
      c = c || formData.get("c");
      l = l || formData.get("l");
      f = f || formData.get("f");
      e = e || formData.get("e");
    } catch (e_parse) {
      console.log(`📡 Body parse error: ${e_parse.message}`);
    }
  }

  // Fallbacks
  c = c || "unknown_campaign";
  l = l || "test_lead";
  f = f || "Philip";
  e = e || "";

  const streamUrl = `wss://railway-gh95.onrender.com/`;

  console.log(`📡 WEBHOOK ACTIVATED: Campaign ${c} | Lead ${l} | Name ${f}`);
  console.log(`🔗 Routing to: ${streamUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" track="inbound_track">
      <Parameter name="c" value="${c}" />
      <Parameter name="l" value="${l}" />
      <Parameter name="f" value="${f}" />
      <Parameter name="e" value="${e}" />
    </Stream>
  </Connect>
  <Pause length="60" />
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "application/xml" }
  });
});

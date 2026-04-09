// @ts-nocheck — Deno runtime; Deno.env and Deno.serve are valid in Supabase Edge Functions

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { name, email, subject, message } = await req.json();

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "Name, email, and message are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")!;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .header{background:#111;padding:24px 32px}
  .header h1{color:#AC66A7;font-size:18px;font-weight:700;margin:0}
  .body{padding:32px}
  .field{margin-bottom:20px}
  .label{font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .value{font-size:15px;color:#111;line-height:1.6}
  .message-box{background:#f9f9f9;border-radius:8px;padding:20px;margin-top:8px}
</style></head>
<body>
<div class="wrap">
  <div class="header"><h1>New Contact Form Submission</h1></div>
  <div class="body">
    <div class="field"><div class="label">Name</div><div class="value">${name}</div></div>
    <div class="field"><div class="label">Email</div><div class="value"><a href="mailto:${email}">${email}</a></div></div>
    <div class="field"><div class="label">Subject</div><div class="value">${subject || "General Inquiry"}</div></div>
    <div class="field"><div class="label">Message</div><div class="message-box value">${message.replace(/\n/g, "<br>")}</div></div>
  </div>
</div>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Optimized Human <support@theoptimizedhumanproject.com>",
        to: ["support@theoptimizedhumanproject.com"],
        reply_to: email,
        subject: `[Contact Form] ${subject || "General Inquiry"} — ${name}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      throw new Error("Failed to send email");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Contact form error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

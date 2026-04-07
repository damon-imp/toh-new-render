// @ts-nocheck — Deno runtime; Deno.env and Deno.serve are valid in Supabase Edge Functions

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { firstName, email, source, customFields } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ghlToken = Deno.env.get("GHL_API_TOKEN")!;
    const locationId = Deno.env.get("GHL_LOCATION_ID")!;

    const ghlHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ghlToken}`,
      "Version": "2021-07-28",
    };

    // Upsert the contact
    const upsertRes = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: ghlHeaders,
      body: JSON.stringify({
        locationId,
        firstName,
        email,
        source: source || "OH Score Assessment",
        customFields: customFields || [],
      }),
    });

    const upsertData = await upsertRes.json();
    const contactId = upsertData.contact?.id;

    // Enroll in workflow if contact was created/found
    if (contactId) {
      const workflowId = Deno.env.get("GHL_WORKFLOW_ID") || "e8c82a90-3907-42cc-9c59-345f1664ea60";
      await fetch(
        `https://services.leadconnectorhq.com/contacts/${contactId}/workflow/${workflowId}`,
        { method: "POST", headers: ghlHeaders }
      );
    }

    return new Response(JSON.stringify({ success: true, contactId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("GHL upsert error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

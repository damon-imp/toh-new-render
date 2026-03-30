// @ts-nocheck — Deno runtime; URL imports and Deno.env are valid in Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      userId,
      customerEmail,
      customerName,
      shippingAddress,
      billingAddress,
      items,
      subtotal,
      shippingProtection,
      tax = 0,
      refCode,
    } = body;

    const shipping = 10.00;
    const protectionCost = shippingProtection ? 5.00 : 0.00;
    const taxAmount = Number(tax) || 0;
    const total = subtotal + shipping + protectionCost + taxAmount;

    // ── Save order to Supabase ──────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        customer_email: customerEmail,
        customer_name: customerName,
        shipping_address: shippingAddress,
        billing_address: billingAddress || shippingAddress,
        items,
        subtotal,
        shipping,
        shipping_protection: protectionCost,
        tax: taxAmount,
        total,
        ref_code: refCode || null,
        status: "pending",
      })
      .select("order_number")
      .single();

    if (orderError) throw orderError;
    const orderNumber = orderData.order_number;

    // ── Clear cart ──────────────────────────────────────────────
    await supabase.from("cart_items").delete().eq("user_id", userId);

    // ── Save/update profile with shipping address ───────────────
    await supabase.from("profiles").upsert({
      id: userId,
      first_name: shippingAddress.firstName,
      last_name: shippingAddress.lastName,
      phone: shippingAddress.phone || null,
      address1: shippingAddress.address1,
      address2: shippingAddress.address2 || null,
      city: shippingAddress.city,
      state: shippingAddress.state,
      zip: shippingAddress.zip,
      country: shippingAddress.country || "US",
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    // ── Format helpers ──────────────────────────────────────────
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const orderDate = new Date().toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const orderTime = new Date().toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    });

    const addr = shippingAddress;
    const addrBlock = `${addr.firstName} ${addr.lastName}<br>${addr.address1}${addr.address2 ? "<br>" + addr.address2 : ""}<br>${addr.city}, ${addr.state} ${addr.zip}<br>${addr.country || "United States"}`;

    const itemRowsHtml = items.map((item: any) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e5e5e5;vertical-align:middle">
          <img src="https://theoptimizedhumanproject.com/images/${item.imgKey}.png" width="60" height="60" style="border-radius:8px;object-fit:cover;background:#f5f5f5" alt="${item.name}">
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e5e5;vertical-align:middle">
          <div style="font-weight:600;color:#111;font-size:14px">${item.name}</div>
          <div style="color:#888;font-size:12px">${item.form} · ${item.content}</div>
          <div style="color:#888;font-size:12px">${fmt(item.price)} × ${item.qty}</div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e5e5e5;vertical-align:middle;text-align:right;font-weight:600;font-size:14px;color:#111">
          ${fmt(item.price * item.qty)}
        </td>
      </tr>`).join("");

    const resendKey = Deno.env.get("RESEND_API_KEY")!;

    // ── STAFF NOTIFICATION EMAIL ────────────────────────────────
    const staffHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .header{padding:24px 32px;border-bottom:1px solid #e5e5e5}
  .body{padding:32px}
  .btn{display:inline-block;background:#2d7a4f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
  .section-title{font-weight:700;font-size:15px;color:#111;margin:24px 0 12px;padding-top:24px;border-top:1px solid #e5e5e5}
  .meta-row{margin:6px 0;font-size:14px;color:#444}
  .meta-label{font-weight:600;color:#111}
  .totals td{padding:6px 0;font-size:14px;color:#444}
  .totals .total-row td{font-weight:700;font-size:16px;color:#111;border-top:2px solid #111;padding-top:10px}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div style="font-size:18px;font-weight:700;color:#111">${customerName} placed order #${orderNumber} on ${orderDate} at ${orderTime}.</div>
  </div>
  <div class="body">
    <p class="section-title" style="margin-top:0;padding-top:0;border-top:none">Order summary</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemRowsHtml}
    </table>
    <table class="totals" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
      <tr><td>Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
      ${shippingProtection ? `<tr><td>Shipping Protection</td><td style="text-align:right">${fmt(5)}</td></tr>` : ""}
      ${taxAmount > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmt(taxAmount)}</td></tr>` : ""}
      <tr><td>Shipping (Standard)</td><td style="text-align:right">${fmt(shipping)}</td></tr>
      <tr class="total-row"><td>Total</td><td style="text-align:right">${fmt(total)} USD</td></tr>
    </table>

    <p class="section-title">Payment processing method</p>
    <p class="meta-row">Pay via invoice</p>

    <p class="section-title">Delivery method</p>
    <p class="meta-row">Standard</p>

    <p class="section-title">Shipping address</p>
    <p class="meta-row" style="line-height:1.8">${addrBlock}</p>

    ${shippingAddress.phone ? `<p class="meta-row"><span class="meta-label">Phone:</span> ${shippingAddress.phone}</p>` : ""}
    ${refCode ? `<p class="meta-row"><span class="meta-label">Affiliate ref:</span> ${refCode}</p>` : ""}

    <p style="margin-top:24px;font-size:12px;color:#aaa">Order placed by ${customerEmail}</p>
  </div>
</div>
</body>
</html>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Optimized Human <support@theoptimizedhumanproject.com>",
        to: ["jay@toh100.com", "damon@impruvu.io", "info@impruvu.io"],
        subject: `[The Optimized Human] Order #${orderNumber} placed by ${customerName}`,
        html: staffHtml,
      }),
    });

    // ── CUSTOMER CONFIRMATION EMAIL ─────────────────────────────
    const customerHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .header{background:#111;padding:32px;text-align:center}
  .logo-mark{font-size:32px;font-weight:900;color:#AC66A7;letter-spacing:-1px}
  .logo-sub{font-size:10px;color:#999;letter-spacing:2px;text-transform:uppercase;margin-top:2px}
  .body{padding:40px 32px}
  .step-box{background:#f9f9f9;border-radius:8px;padding:12px 16px;margin:8px 0;display:flex;gap:12px;align-items:flex-start}
  .step-num{background:#AC66A7;color:#fff;border-radius:50%;width:24px;height:24px;min-width:24px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;margin-top:2px}
  .alert-box{background:#fff8e1;border-left:4px solid #f59e0b;border-radius:4px;padding:16px;margin:24px 0}
  .section-title{font-weight:700;font-size:15px;color:#111;margin:24px 0 12px;padding-top:24px;border-top:1px solid #e5e5e5}
  .totals td{padding:6px 0;font-size:14px;color:#444}
  .totals .total-row td{font-weight:700;font-size:16px;color:#111;border-top:2px solid #111;padding-top:10px}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo-mark">OH</div>
    <div class="logo-sub">The Optimized Human</div>
  </div>
  <div class="body">
    <h1 style="font-size:24px;font-weight:800;color:#111;margin:0 0 4px">Thank you, ${shippingAddress.firstName}!</h1>
    <p style="color:#555;font-size:16px;margin:0 0 24px">Order #${orderNumber} — One More Step to Complete Your Order</p>

    <p style="color:#333;font-size:15px;line-height:1.7">Thank you for your order! Just one more step before it ships. Your payment will be completed through a <strong>separate invoice that will be sent to your email shortly.</strong></p>

    <p style="font-weight:700;font-size:16px;color:#111;margin:28px 0 12px">Here's what happens next:</p>

    <div class="step-box">
      <div class="step-num">1</div>
      <div style="font-size:14px;color:#333;line-height:1.6">You will receive an invoice via email within the next few minutes.</div>
    </div>
    <div class="step-box">
      <div class="step-num">2</div>
      <div style="font-size:14px;color:#333;line-height:1.6">The invoice will come from <strong>The Optimized Human</strong> and will be labeled as <strong>"Coaching Services."</strong></div>
    </div>
    <div class="step-box">
      <div class="step-num">3</div>
      <div style="font-size:14px;color:#333;line-height:1.6">Simply complete the invoice payment.</div>
    </div>
    <div class="step-box">
      <div class="step-num">4</div>
      <div style="font-size:14px;color:#333;line-height:1.6">Once payment is received, your order will be packaged and shipped the same day (when paid during normal business hours).</div>
    </div>

    <div class="alert-box">
      <p style="font-weight:700;color:#92400e;margin:0 0 6px">Important:</p>
      <p style="color:#78350f;font-size:14px;margin:0;line-height:1.6">The invoice description will say "coaching" for processing purposes, but it corresponds directly to the order you just placed.</p>
    </div>

    <p style="color:#555;font-size:14px;line-height:1.7">If you do not see your invoice within 10–15 minutes, please check your spam or promotions folder.</p>

    <p style="color:#555;font-size:14px;line-height:1.7">If you need help at any point, contact our team at <a href="mailto:support@theoptimizedhumanproject.com" style="color:#AC66A7">support@theoptimizedhumanproject.com</a> and we'll take care of you.</p>

    <p style="color:#333;font-size:14px;margin-top:24px">We appreciate your trust and look forward to serving you.</p>
    <p style="color:#333;font-size:14px;font-weight:600">— TOH Team</p>

    <p class="section-title">Order Details</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemRowsHtml}
    </table>
    <table class="totals" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
      <tr><td>Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
      ${shippingProtection ? `<tr><td>Shipping Protection</td><td style="text-align:right">${fmt(5)}</td></tr>` : ""}
      ${taxAmount > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmt(taxAmount)}</td></tr>` : ""}
      <tr><td>Shipping (Standard)</td><td style="text-align:right">${fmt(shipping)}</td></tr>
      <tr class="total-row"><td>Total</td><td style="text-align:right">${fmt(total)} USD</td></tr>
    </table>

    <p class="section-title">Shipping address</p>
    <p style="font-size:14px;color:#444;line-height:1.8;margin:0">${addrBlock}</p>

    <p style="margin-top:32px;font-size:11px;color:#aaa;text-align:center">Order #${orderNumber} · ${orderDate} · The Optimized Human</p>
  </div>
</div>
</body>
</html>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Optimized Human <support@theoptimizedhumanproject.com>",
        to: [customerEmail],
        subject: `Order #${orderNumber} Received — One More Step`,
        html: customerHtml,
      }),
    });

    return new Response(JSON.stringify({ success: true, orderNumber }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

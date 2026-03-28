// ============================================================
// TOH AFFILIATE TRACKING - toh-affiliate.js
// ============================================================
// Add to every page: <script src="toh-affiliate.js"></script>
// Place AFTER the Supabase client initialization.
//
// How it works:
// 1. Visitor lands on any page with ?ref=CODE
// 2. We validate the code against Supabase
// 3. Store the ref code in a cookie (30-day window)
// 4. Log the click in referral_clicks
// 5. When checkout happens, the ref code is available
//    to attach to the order via TOH_Affiliate.getRefCode()
// ============================================================

(function() {
  'use strict';

  const SUPABASE_URL = 'https://qrozjbmimzcwegzolptm.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE'; // Replace with your anon key
  const COOKIE_NAME = 'toh_ref';
  const COOKIE_DAYS = 30;
  const REF_PARAM = 'ref';

  // ---- Cookie helpers ----
  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() +
      ';path=/;SameSite=Lax;Secure';
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function deleteCookie(name) {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  }

  // ---- Simple hash for IP dedup (no raw IPs stored) ----
  async function simpleHash(str) {
    if (!str) return null;
    try {
      const data = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch(e) {
      return null;
    }
  }

  // ---- Supabase RPC caller ----
  async function rpc(fnName, params) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify(params)
      });
      if (!res.ok) return null;
      return await res.json();
    } catch(e) {
      console.warn('[TOH Affiliate] RPC error:', e);
      return null;
    }
  }

  // ---- Main tracking logic ----
  async function init() {
    // 1. Check URL for ref param
    const url = new URL(window.location.href);
    const refParam = url.searchParams.get(REF_PARAM);

    if (refParam) {
      // Validate the ref code
      const result = await rpc('validate_ref_code', { code: refParam });

      if (result && result.length > 0 && result[0].is_valid) {
        // Valid affiliate code -- store in cookie
        setCookie(COOKIE_NAME, refParam, COOKIE_DAYS);

        // Log the click
        await rpc('log_referral_click', {
          p_ref_code: refParam,
          p_landing_page: window.location.pathname,
          p_referrer_url: document.referrer || null,
          p_ip_hash: null, // We skip IP hashing client-side for privacy
          p_user_agent: navigator.userAgent.substring(0, 200)
        });

        // Clean the URL (remove ?ref= without page reload)
        url.searchParams.delete(REF_PARAM);
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
      // If invalid code, do nothing -- don't store garbage
    }
  }

  // ---- Public API ----
  window.TOH_Affiliate = {
    // Get the current ref code (for checkout attribution)
    getRefCode: function() {
      return getCookie(COOKIE_NAME);
    },

    // Check if this session has an affiliate attribution
    hasAttribution: function() {
      return !!getCookie(COOKIE_NAME);
    },

    // Clear attribution (e.g., after order is placed and recorded)
    clearAttribution: function() {
      deleteCookie(COOKIE_NAME);
    },

    // Manually record a conversion (call from your checkout/order flow)
    // Returns the conversion ID if successful
    recordConversion: async function(customerEmail, orderItems, orderTotal) {
      const refCode = getCookie(COOKIE_NAME);
      if (!refCode) return null;

      const result = await rpc('record_conversion', {
        p_ref_code: refCode,
        p_customer_email: customerEmail,
        p_order_items: orderItems,
        p_order_total: orderTotal
      });

      return result;
    }
  };

  // ---- Auto-init on page load ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

// ============================================================
// USAGE IN CHECKOUT FLOW:
// ============================================================
//
// When processing an order, check for affiliate attribution:
//
//   if (TOH_Affiliate.hasAttribution()) {
//     const conversionId = await TOH_Affiliate.recordConversion(
//       'customer@email.com',
//       [
//         { product_id: 'bpc', name: 'BPC-157 10mg', qty: 2, price: 64.99 },
//         { product_id: 'tb500', name: 'TB-500 10mg', qty: 1, price: 64.99 }
//       ],
//       194.97 // order total
//     );
//     console.log('Affiliate conversion recorded:', conversionId);
//   }
//
// For manual invoicing flow:
// The ref code is available via TOH_Affiliate.getRefCode()
// Include it in the order/invoice record so you can attribute
// the sale when payment is confirmed.
// ============================================================

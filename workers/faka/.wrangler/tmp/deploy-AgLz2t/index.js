var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
}
__name(getCorsHeaders, "getCorsHeaders");
function verifyAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  return token === env.ADMIN_KEY;
}
__name(verifyAdmin, "verifyAdmin");
function generateOrderNo() {
  const now = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `FK${now}${random}`;
}
__name(generateOrderNo, "generateOrderNo");
var index_default = {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/issue" && request.method === "POST") {
        return await issueCard(request, env, corsHeaders);
      }
      if (path === "/stock" && request.method === "GET") {
        return await checkStock(env, corsHeaders);
      }
      if (path === "/admin/add" && request.method === "POST") {
        return await addCards(request, env, corsHeaders);
      }
      if (path === "/admin/stats" && request.method === "GET") {
        return await getStats(request, env, corsHeaders);
      }
      if (path === "/health" && request.method === "GET") {
        return new Response(JSON.stringify({ status: "ok", service: "faka" }), {
          headers: corsHeaders
        });
      }
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: corsHeaders
      });
    } catch (err) {
      console.error("[faka-worker] Error:", err);
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};
async function issueCard(request, env, headers) {
  const body = await request.json();
  const plan = body.plan || "pro";
  const buyerContact = body.buyerContact || "";
  const orderNo = body.orderNo || generateOrderNo();
  const { results } = await env.DB.prepare(
    `SELECT id, token, plan, valid_days, generate_quota, expand_quota
     FROM cards
     WHERE plan = ? AND used = 0
     ORDER BY id ASC
     LIMIT 1`
  ).bind(plan).all();
  if (!results || results.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "No available cards in stock",
        errorZh: "\u5E93\u5B58\u4E0D\u8DB3\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u8865\u8D27"
      }),
      { status: 400, headers }
    );
  }
  const card = results[0];
  await env.DB.prepare(
    `UPDATE cards
     SET used = 1, order_no = ?, buyer_contact = ?, used_at = datetime('now')
     WHERE id = ?`
  ).bind(orderNo, buyerContact, card.id).run();
  return new Response(
    JSON.stringify({
      success: true,
      orderNo,
      card: {
        token: card.token,
        plan: card.plan,
        validDays: card.valid_days,
        generateQuota: card.generate_quota,
        expandQuota: card.expand_quota
      }
    }),
    { headers }
  );
}
__name(issueCard, "issueCard");
async function checkStock(env, headers) {
  const { results } = await env.DB.prepare(
    `SELECT plan, COUNT(*) as count
     FROM cards
     WHERE used = 0
     GROUP BY plan`
  ).all();
  const stock = {};
  results?.forEach((row) => {
    stock[row.plan] = row.count;
  });
  if (!stock.pro) stock.pro = 0;
  return new Response(JSON.stringify({ success: true, stock }), { headers });
}
__name(checkStock, "checkStock");
async function addCards(request, env, headers) {
  if (!verifyAdmin(request, env)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers }
    );
  }
  const body = await request.json();
  if (!body.tokens || !Array.isArray(body.tokens) || body.tokens.length === 0) {
    return new Response(
      JSON.stringify({ error: "tokens array is required" }),
      { status: 400, headers }
    );
  }
  const plan = body.plan || "pro";
  const tier = body.tier || "standard";
  const validDays = body.validDays || 30;
  const generateQuota = body.generateQuota ?? 200;
  const expandQuota = body.expandQuota ?? 50;
  let inserted = 0;
  let duplicated = 0;
  for (const token of body.tokens) {
    if (!token.trim()) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO cards (token, plan, tier, valid_days, generate_quota, expand_quota)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(token.trim(), plan, tier, validDays, generateQuota, expandQuota).run();
      inserted++;
    } catch (err) {
      duplicated++;
    }
  }
  return new Response(
    JSON.stringify({
      success: true,
      inserted,
      duplicated,
      total: body.tokens.length
    }),
    { headers }
  );
}
__name(addCards, "addCards");
async function getStats(request, env, headers) {
  if (!verifyAdmin(request, env)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers }
    );
  }
  const totalResult = await env.DB.prepare(
    "SELECT COUNT(*) as total FROM cards"
  ).first();
  const usedResult = await env.DB.prepare(
    "SELECT COUNT(*) as used FROM cards WHERE used = 1"
  ).first();
  const { results } = await env.DB.prepare(
    `SELECT plan, COUNT(*) as count
     FROM cards
     WHERE used = 0
     GROUP BY plan`
  ).all();
  const stock = {};
  results?.forEach((row) => {
    stock[row.plan] = row.count;
  });
  return new Response(
    JSON.stringify({
      success: true,
      stats: {
        total: totalResult?.total || 0,
        used: usedResult?.used || 0,
        available: (totalResult?.total || 0) - (usedResult?.used || 0),
        stock
      }
    }),
    { headers }
  );
}
__name(getStats, "getStats");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

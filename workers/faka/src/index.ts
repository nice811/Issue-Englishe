/**
 * Issue Englisher 发卡系统 - Cloudflare Worker
 *
 * 功能：
 * - POST /issue       : 发放卡密（从未使用的卡密中取一个）
 * - GET  /stock       : 查询库存
 * - POST /admin/add   : 批量添加卡密（需要 admin key）
 * - POST /admin/stats : 获取统计信息（需要 admin key）
 */

export interface Env {
  DB: D1Database
  ADMIN_KEY: string
  ALLOWED_ORIGINS: string
}

// ============ CORS 处理 ============
function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]

  return {
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }
}

// ============ 验证 Admin Key ============
function verifyAdmin(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  return token === env.ADMIN_KEY
}

// ============ 生成订单号 ============
function generateOrderNo(): string {
  const now = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `FK${now}${random}`
}

// ============ 路由处理 ============
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env)

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 })
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // 发放卡密
      if (path === '/issue' && request.method === 'POST') {
        return await issueCard(request, env, corsHeaders)
      }

      // 查询库存
      if (path === '/stock' && request.method === 'GET') {
        return await checkStock(env, corsHeaders)
      }

      // 批量添加卡密（管理员）
      if (path === '/admin/add' && request.method === 'POST') {
        return await addCards(request, env, corsHeaders)
      }

      // 获取统计（管理员）
      if (path === '/admin/stats' && request.method === 'GET') {
        return await getStats(request, env, corsHeaders)
      }

      // 健康检查
      if (path === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', service: 'faka' }), {
          headers: corsHeaders,
        })
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: corsHeaders,
      })
    } catch (err) {
      console.error('[faka-worker] Error:', err)
      return new Response(
        JSON.stringify({ error: (err as Error).message }),
        { status: 500, headers: corsHeaders }
      )
    }
  },
}

// ============ 发放卡密 ============
async function issueCard(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as {
    plan?: string
    buyerContact?: string
    orderNo?: string
  }

  const plan = body.plan || 'pro'
  const buyerContact = body.buyerContact || ''
  const orderNo = body.orderNo || generateOrderNo()

  const { results } = await env.DB.prepare(
    `SELECT id, token, plan, valid_days, generate_quota, expand_quota
     FROM cards
     WHERE plan = ? AND used = 0
     ORDER BY id ASC
     LIMIT 1`
  )
    .bind(plan)
    .all<{
      id: number
      token: string
      plan: string
      valid_days: number
      generate_quota: number
      expand_quota: number
    }>()

  if (!results || results.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No available cards in stock',
        errorZh: '库存不足，请联系管理员补货',
      }),
      { status: 400, headers }
    )
  }

  const card = results[0]

  await env.DB.prepare(
    `UPDATE cards
     SET used = 1, order_no = ?, buyer_contact = ?, used_at = datetime('now')
     WHERE id = ?`
  )
    .bind(orderNo, buyerContact, card.id)
    .run()

  return new Response(
    JSON.stringify({
      success: true,
      orderNo,
      card: {
        token: card.token,
        plan: card.plan,
        validDays: card.valid_days,
        generateQuota: card.generate_quota,
        expandQuota: card.expand_quota,
      },
    }),
    { headers }
  )
}

// ============ 查询库存 ============
async function checkStock(
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT plan, COUNT(*) as count
     FROM cards
     WHERE used = 0
     GROUP BY plan`
  ).all<{ plan: string; count: number }>()

  const stock: Record<string, number> = {}
  results?.forEach(row => {
    stock[row.plan] = row.count
  })

  if (!stock.pro) stock.pro = 0

  return new Response(JSON.stringify({ success: true, stock }), { headers })
}

// ============ 批量添加卡密（管理员）=========
async function addCards(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers }
    )
  }

  const body = (await request.json()) as {
    tokens: string[]
    plan?: string
    tier?: string
    validDays?: number
    generateQuota?: number
    expandQuota?: number
  }

  if (!body.tokens || !Array.isArray(body.tokens) || body.tokens.length === 0) {
    return new Response(
      JSON.stringify({ error: 'tokens array is required' }),
      { status: 400, headers }
    )
  }

  const plan = body.plan || 'pro'
  const tier = body.tier || 'standard'
  const validDays = body.validDays || 30
  const generateQuota = body.generateQuota ?? 200
  const expandQuota = body.expandQuota ?? 50

  let inserted = 0
  let duplicated = 0

  for (const token of body.tokens) {
    if (!token.trim()) continue

    try {
      await env.DB.prepare(
        `INSERT INTO cards (token, plan, tier, valid_days, generate_quota, expand_quota)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(token.trim(), plan, tier, validDays, generateQuota, expandQuota)
        .run()
      inserted++
    } catch (err) {
      duplicated++
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      inserted,
      duplicated,
      total: body.tokens.length,
    }),
    { headers }
  )
}

// ============ 获取统计（管理员）=========
async function getStats(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers }
    )
  }

  const totalResult = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM cards'
  ).first<{ total: number }>()

  const usedResult = await env.DB.prepare(
    'SELECT COUNT(*) as used FROM cards WHERE used = 1'
  ).first<{ used: number }>()

  const { results } = await env.DB.prepare(
    `SELECT plan, COUNT(*) as count
     FROM cards
     WHERE used = 0
     GROUP BY plan`
  ).all<{ plan: string; count: number }>()

  const stock: Record<string, number> = {}
  results?.forEach(row => {
    stock[row.plan] = row.count
  })

  return new Response(
    JSON.stringify({
      success: true,
      stats: {
        total: totalResult?.total || 0,
        used: usedResult?.used || 0,
        available: (totalResult?.total || 0) - (usedResult?.used || 0),
        stock,
      },
    }),
    { headers }
  )
}

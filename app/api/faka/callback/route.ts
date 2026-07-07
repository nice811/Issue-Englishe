import { NextRequest, NextResponse } from 'next/server'
import { generateToken } from '../../../../lib/token'

/**
 * 独角数卡（发卡网）支付回调接口框架
 *
 * 功能说明：
 * - 接收独角数卡支付成功后的回调通知
 * - 验证签名，确保请求来自合法的发卡平台
 * - 根据订单信息生成对应套餐的 Pro 令牌
 * - 返回令牌给发卡平台，用于自动发货
 *
 * 配置步骤（后续接入时）：
 * 1. 在独角数卡后台设置回调地址：https://your-domain/api/faka/callback
 * 2. 配置 FAKA_CALLBACK_SECRET 环境变量（用于签名验证）
 * 3. 在独角数卡商品中选择「API 接口发货」方式
 *
 * 注意：当前为框架预留，核心验证和发货逻辑需根据实际独角数卡版本调整
 */

// ============ 类型定义 ============
interface FakaCallbackPayload {
  order_id?: string
  out_trade_no?: string
  total_fee?: string | number
  actual_fee?: string | number
  product_id?: string | number
  product_name?: string
  quantity?: string | number
  email?: string
  contact?: string
  sign?: string
  [key: string]: any
}

interface GenerateTokenOptions {
  plan: 'pro' | 'enterprise'
  validDays: number
  generateQuota: number
  expandQuota: number
  tier: string
}

// ============ 产品套餐映射 ============
const PRODUCT_PLAN_MAP: Record<string, GenerateTokenOptions> = {
  'pro_monthly': { plan: 'pro', validDays: 30, generateQuota: 200, expandQuota: 50, tier: 'standard' },
  'pro_quarterly': { plan: 'pro', validDays: 90, generateQuota: 200, expandQuota: 50, tier: 'standard' },
  'pro_yearly': { plan: 'pro', validDays: 365, generateQuota: 200, expandQuota: 50, tier: 'standard' },
  'enterprise_monthly': { plan: 'enterprise', validDays: 30, generateQuota: 1000, expandQuota: -1, tier: 'enterprise' },
  'enterprise_yearly': { plan: 'enterprise', validDays: 365, generateQuota: 1000, expandQuota: -1, tier: 'enterprise' },
}

// ============ 工具函数 ============

/**
 * 根据产品 ID 或名称获取套餐配置
 * TODO: 实际接入时根据独角数卡的产品 ID 调整映射关系
 */
function getPlanByProduct(productId: string, productName?: string): GenerateTokenOptions {
  if (PRODUCT_PLAN_MAP[productId]) {
    return PRODUCT_PLAN_MAP[productId]
  }
  const name = (productName || '').toLowerCase()
  if (name.includes('enterprise') || name.includes('企业')) {
    return name.includes('year') || name.includes('年')
      ? PRODUCT_PLAN_MAP.enterprise_yearly
      : PRODUCT_PLAN_MAP.enterprise_monthly
  }
  if (name.includes('year') || name.includes('年')) {
    return PRODUCT_PLAN_MAP.pro_yearly
  }
  if (name.includes('quarter') || name.includes('季')) {
    return PRODUCT_PLAN_MAP.pro_quarterly
  }
  return PRODUCT_PLAN_MAP.pro_monthly
}

/**
 * 验证回调签名
 * TODO: 实际接入时根据独角数卡的签名算法实现
 *
 * 独角数卡常见签名方式：
 * - 将所有参数按 key 字典序排序
 * - 拼接成 key1=value1&key2=value2...
 * - 末尾拼接 &key=APP_SECRET
 * - md5 签名
 */
function verifyCallbackSignature(payload: Record<string, any>): boolean {
  const secret = process.env.FAKA_CALLBACK_SECRET
  if (!secret) {
    console.warn('[faka-callback] FAKA_CALLBACK_SECRET not configured, skipping signature verification')
    return true
  }

  // TODO: 实现具体的签名验证逻辑
  // const sign = payload.sign
  // if (!sign) return false
  // const sortedKeys = Object.keys(payload).filter(k => k !== 'sign').sort()
  // const signStr = sortedKeys.map(k => `${k}=${payload[k]}`).join('&') + `&key=${secret}`
  // const computedSign = crypto.createHash('md5').update(signStr).digest('hex')
  // return computedSign === sign.toLowerCase()

  return true // 框架阶段默认通过，实际接入需打开上面的验证
}

// ============ API 路由 ============

/**
 * POST /api/faka/callback
 * 独角数卡支付成功回调
 *
 * 预期返回格式（独角数卡 API 发货）：
 * {
 *   code: 1,        // 1=成功，0=失败
 *   msg: 'success', // 消息
 *   data: {
 *     cards: ['token1', 'token2']  // 卡密列表
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  let payload: FakaCallbackPayload

  try {
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      payload = await req.json()
    } else {
      const formData = await req.formData()
      payload = {}
      formData.forEach((value, key) => {
        payload[key] = typeof value === 'string' ? value : value.toString()
      })
    }
  } catch (error) {
    console.error('[faka-callback] Failed to parse request body:', error)
    return NextResponse.json(
      { code: 0, msg: 'Invalid request body' },
      { status: 400 }
    )
  }

  const orderId = payload.order_id || payload.out_trade_no || 'unknown'
  console.log(`[faka-callback] Received callback for order: ${orderId}`)

  try {
    // 1. 签名验证
    if (!verifyCallbackSignature(payload)) {
      console.error(`[faka-callback] Invalid signature for order: ${orderId}`)
      return NextResponse.json(
        { code: 0, msg: 'Invalid signature' },
        { status: 401 }
      )
    }

    // 2. 订单重复性校验（可选）
    // TODO: 实际接入时建议使用 Redis/数据库 记录已处理的订单号，防止重复发货
    // const orderProcessed = await checkOrderProcessed(orderId)
    // if (orderProcessed) {
    //   return NextResponse.json({ code: 1, msg: 'Order already processed' })
    // }

    // 3. 根据产品信息生成令牌
    const productId = String(payload.product_id || '')
    const productName = payload.product_name || ''
    const quantity = parseInt(String(payload.quantity || '1'), 10)
    const planOptions = getPlanByProduct(productId, productName)

    const tokens: string[] = []
    for (let i = 0; i < quantity; i++) {
      const token = generateToken({
        plan: planOptions.plan,
        tier: planOptions.tier,
        validDays: planOptions.validDays,
        generateQuota: planOptions.generateQuota,
        expandQuota: planOptions.expandQuota,
        meta: {
          source: 'faka',
          orderId,
          productId,
          productName,
          createdAt: new Date().toISOString(),
        },
      })
      tokens.push(token)
    }

    // 4. 记录订单（可选）
    // TODO: 实际接入时将订单和令牌关联存储，便于后续查询和售后
    // await saveOrderRecord({ orderId, productId, productName, quantity, tokens })

    console.log(`[faka-callback] Generated ${tokens.length} token(s) for order ${orderId}`)

    // 5. 返回卡密给发卡平台
    return NextResponse.json({
      code: 1,
      msg: 'success',
      data: {
        cards: tokens,
      },
    })
  } catch (error) {
    console.error(`[faka-callback] Error processing order ${orderId}:`, error)
    return NextResponse.json(
      { code: 0, msg: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/faka/callback
 * 健康检查用，返回接口状态
 */
export async function GET() {
  const secretConfigured = !!process.env.FAKA_CALLBACK_SECRET
  return NextResponse.json({
    status: 'ok',
    service: 'faka-callback',
    secretConfigured,
    message: secretConfigured
      ? 'Callback endpoint is ready'
      : 'WARNING: FAKA_CALLBACK_SECRET not configured',
  })
}

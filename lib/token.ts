import crypto from 'crypto'

const TOKEN_PREFIX = 'ie_'
const TOKEN_VERSION = 'v1'
const DAY_MS = 24 * 60 * 60 * 1000

interface TokenPayload {
  sub: string
  plan: 'pro' | 'enterprise'
  tier: string
  iat: number
  exp: number
  quotas: {
    generate: number
    expand: number
  }
  meta?: Record<string, any>
  // 设备绑定：生成令牌时若指定 deviceFingerprint，则写入此字段
  // 验证时若 payload 含 devHash，则请求方必须提供相同设备指纹
  devHash?: string
}

interface VerifyResult {
  valid: boolean
  payload?: TokenPayload
  error?: string
}

function getSecret(): string {
  const secret = process.env.TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('TOKEN_SECRET environment variable is required (min 32 chars)')
  }
  return secret
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

function sign(payloadStr: string): string {
  const secret = getSecret()
  return crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url')
}

export function generateToken(opts: {
  subject?: string
  plan?: 'pro' | 'enterprise'
  tier?: string
  validDays?: number
  generateQuota?: number
  expandQuota?: number
  meta?: Record<string, any>
  deviceFingerprint?: string
}): string {
  const now = Math.floor(Date.now() / 1000)
  const validDays = opts.validDays || 365
  const payload: TokenPayload = {
    sub: opts.subject || crypto.randomBytes(8).toString('hex'),
    plan: opts.plan || 'pro',
    tier: opts.tier || 'standard',
    iat: now,
    exp: now + validDays * 86400,
    quotas: {
      generate: opts.generateQuota ?? 200,
      expand: opts.expandQuota ?? -1
    },
    meta: opts.meta,
    devHash: opts.deviceFingerprint ? hashDevice(opts.deviceFingerprint) : undefined
  }

  const payloadStr = JSON.stringify(payload)
  const payloadB64 = base64urlEncode(Buffer.from(payloadStr))
  const signature = sign(payloadB64)

  return `${TOKEN_PREFIX}${TOKEN_VERSION}_${payloadB64}.${signature}`
}

// 设备指纹哈希：存储哈希值而非明文，保护隐私
function hashDevice(fp: string): string {
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 32)
}

export function verifyToken(token: string): VerifyResult {
  try {
    if (!token || !token.startsWith(TOKEN_PREFIX)) {
      return { valid: false, error: 'Invalid token prefix' }
    }

    const rest = token.slice(TOKEN_PREFIX.length)
    const versionMatch = rest.match(/^v(\d+)_(.+)\.(.+)$/)
    if (!versionMatch) {
      return { valid: false, error: 'Invalid token format' }
    }

    const payloadB64 = versionMatch[2]
    const signature = versionMatch[3]

    const expectedSignature = sign(payloadB64)
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return { valid: false, error: 'Invalid signature' }
    }

    let payload: TokenPayload
    try {
      payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'))
    } catch {
      return { valid: false, error: 'Invalid payload' }
    }

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' }
    }

    if (payload.iat && payload.iat > now + 300) {
      return { valid: false, error: 'Token not yet valid' }
    }

    return { valid: true, payload }
  } catch (err) {
    return { valid: false, error: (err as Error).message }
  }
}

export function isValidPaidToken(token: string): boolean {
  if (!token || token.trim().length === 0) return false
  const trimmed = token.trim()

  // 所有令牌必须通过签名验证，不再接受无签名的宽松格式
  if (trimmed.startsWith('ie_v1_')) {
    const result = verifyToken(trimmed)
    if (!result.valid || !result.payload) return false
    return result.payload.plan === 'pro' || result.payload.plan === 'enterprise'
  }

  return false
}

/**
 * 验证令牌并校验设备绑定。
 * - 令牌不含 devHash：返回 valid=true，不校验设备（向后兼容，支持多设备）
 * - 令牌含 devHash：请求方必须提供匹配的 deviceFingerprint，否则返回设备不匹配
 */
export function verifyTokenWithDevice(token: string, deviceFingerprint?: string): VerifyResult {
  const result = verifyToken(token.trim())
  if (!result.valid || !result.payload) return result

  // 令牌未绑定设备：放行
  if (!result.payload.devHash) return result

  // 令牌已绑定设备：校验请求方设备指纹
  if (!deviceFingerprint) {
    return { valid: false, error: 'Device fingerprint required for this token' }
  }
  const requestDevHash = hashDevice(deviceFingerprint)
  if (requestDevHash !== result.payload.devHash) {
    return { valid: false, error: 'Device mismatch: token is bound to another device' }
  }

  return result
}

export function getTokenQuota(token: string): { generate: number; expand: number } {
  const result = verifyToken(token.trim())
  if (result.valid && result.payload) {
    return {
      generate: result.payload.quotas?.generate ?? 200,
      expand: result.payload.quotas?.expand ?? -1
    }
  }
  return { generate: 0, expand: 0 }
}

export function getTokenPlan(token: string): 'free' | 'pro' | 'enterprise' {
  const trimmed = token.trim()
  const result = verifyToken(trimmed)
  if (result.valid && result.payload) {
    return result.payload.plan
  }
  return 'free'
}

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
    meta: opts.meta
  }

  const payloadStr = JSON.stringify(payload)
  const payloadB64 = base64urlEncode(Buffer.from(payloadStr))
  const signature = sign(payloadB64)

  return `${TOKEN_PREFIX}${TOKEN_VERSION}_${payloadB64}.${signature}`
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

  const result = verifyToken(trimmed)
  if (result.valid && result.payload) {
    return result.payload.plan === 'pro' || result.payload.plan === 'enterprise'
  }

  if (trimmed.startsWith('ie_') && trimmed.length >= 16) return true
  if (trimmed.length >= 32 && /^[A-Za-z0-9_\-]+$/.test(trimmed)) return true

  return false
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
  const result = verifyToken(token.trim())
  if (result.valid && result.payload) {
    return result.payload.plan
  }
  if (isValidPaidToken(token)) return 'pro'
  return 'free'
}

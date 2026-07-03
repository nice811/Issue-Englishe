import {
  generateToken,
  verifyToken,
  isValidPaidToken,
  getTokenQuota,
  getTokenPlan
} from './token'

const TEST_SECRET = 'test-secret-key-at-least-32-characters-long-for-testing'

beforeAll(() => {
  process.env.TOKEN_SECRET = TEST_SECRET
})

describe('generateToken', () => {
  it('should generate a token with correct prefix', () => {
    const token = generateToken({ plan: 'pro' })
    expect(token).toMatch(/^ie_v1_/)
  })

  it('should generate unique tokens each time', () => {
    const token1 = generateToken({ plan: 'pro' })
    const token2 = generateToken({ plan: 'pro' })
    expect(token1).not.toBe(token2)
  })

  it('should include subject if provided', () => {
    const token = generateToken({ plan: 'pro', subject: 'user_123' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.sub).toBe('user_123')
  })

  it('should use pro plan by default', () => {
    const token = generateToken({})
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.plan).toBe('pro')
  })

  it('should support enterprise plan', () => {
    const token = generateToken({ plan: 'enterprise' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.plan).toBe('enterprise')
  })

  it('should set default validity to 365 days', () => {
    const token = generateToken({ plan: 'pro' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    const payload = result.payload!
    const diffDays = (payload.exp - payload.iat) / 86400
    expect(diffDays).toBe(365)
  })

  it('should respect custom validity days', () => {
    const token = generateToken({ plan: 'pro', validDays: 30 })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    const payload = result.payload!
    const diffDays = (payload.exp - payload.iat) / 86400
    expect(diffDays).toBe(30)
  })

  it('should include default quotas', () => {
    const token = generateToken({ plan: 'pro' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.quotas.generate).toBe(200)
    expect(result.payload?.quotas.expand).toBe(-1)
  })

  it('should include custom quotas', () => {
    const token = generateToken({ plan: 'pro', generateQuota: 500, expandQuota: 100 })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.quotas.generate).toBe(500)
    expect(result.payload?.quotas.expand).toBe(100)
  })

  it('should include tier', () => {
    const token = generateToken({ plan: 'pro', tier: 'premium' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.tier).toBe('premium')
  })

  it('should include meta data', () => {
    const meta = { company: 'Test Corp', priority: 'high' }
    const token = generateToken({ plan: 'pro', meta })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.meta).toEqual(meta)
  })
})

describe('verifyToken', () => {
  it('should verify a valid token', () => {
    const token = generateToken({ plan: 'pro' })
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload).toBeDefined()
  })

  it('should reject empty token', () => {
    const result = verifyToken('')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should reject token with wrong prefix', () => {
    const result = verifyToken('invalid_token_abc')
    expect(result.valid).toBe(false)
  })

  it('should reject token with invalid format', () => {
    const result = verifyToken('ie_v1_badtoken')
    expect(result.valid).toBe(false)
  })

  it('should reject tampered token (modified payload)', () => {
    const token = generateToken({ plan: 'pro' })
    const parts = token.split('.')
    const payloadPart = parts[0].replace('ie_v1_', '')
    const tamperedPayload = Buffer.from('{"plan":"enterprise","sub":"hacked"}').toString('base64url')
    const tamperedToken = `ie_v1_${tamperedPayload}.${parts[1]}`
    const result = verifyToken(tamperedToken)
    expect(result.valid).toBe(false)
  })

  it('should reject token with wrong signature', () => {
    const token = generateToken({ plan: 'pro' })
    const tamperedToken = token.slice(0, -5) + 'xxxxx'
    const result = verifyToken(tamperedToken)
    expect(result.valid).toBe(false)
  })

  it('should detect expired token', () => {
    const token = generateToken({ plan: 'pro', validDays: -1 })
    const result = verifyToken(token)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('expired')
  })

  it('should have correct iat timestamp', () => {
    const before = Math.floor(Date.now() / 1000)
    const token = generateToken({ plan: 'pro' })
    const after = Math.floor(Date.now() / 1000)
    const result = verifyToken(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.iat).toBeGreaterThanOrEqual(before)
    expect(result.payload?.iat).toBeLessThanOrEqual(after)
  })
})

describe('isValidPaidToken', () => {
  it('should return true for valid pro token', () => {
    const token = generateToken({ plan: 'pro' })
    expect(isValidPaidToken(token)).toBe(true)
  })

  it('should return true for valid enterprise token', () => {
    const token = generateToken({ plan: 'enterprise' })
    expect(isValidPaidToken(token)).toBe(true)
  })

  it('should return false for empty token', () => {
    expect(isValidPaidToken('')).toBe(false)
  })

  it('should return false for random string', () => {
    expect(isValidPaidToken('random-string')).toBe(false)
  })

  it('should return false for expired token', () => {
    const token = generateToken({ plan: 'pro', validDays: -1 })
    expect(isValidPaidToken(token)).toBe(false)
  })

  it('should fallback accept legacy ie_ tokens', () => {
    expect(isValidPaidToken('ie_abc123def456ghi7')).toBe(true)
  })
})

describe('getTokenQuota', () => {
  it('should return quotas from valid token', () => {
    const token = generateToken({ plan: 'pro', generateQuota: 300, expandQuota: 50 })
    const quota = getTokenQuota(token)
    expect(quota.generate).toBe(300)
    expect(quota.expand).toBe(50)
  })

  it('should return zero quotas for invalid token', () => {
    const quota = getTokenQuota('invalid-token')
    expect(quota.generate).toBe(0)
    expect(quota.expand).toBe(0)
  })

  it('should return default quotas for default token', () => {
    const token = generateToken({ plan: 'pro' })
    const quota = getTokenQuota(token)
    expect(quota.generate).toBe(200)
    expect(quota.expand).toBe(-1)
  })
})

describe('getTokenPlan', () => {
  it('should return pro for pro token', () => {
    const token = generateToken({ plan: 'pro' })
    expect(getTokenPlan(token)).toBe('pro')
  })

  it('should return enterprise for enterprise token', () => {
    const token = generateToken({ plan: 'enterprise' })
    expect(getTokenPlan(token)).toBe('enterprise')
  })

  it('should return free for empty token', () => {
    expect(getTokenPlan('')).toBe('free')
  })

  it('should return free for invalid token', () => {
    expect(getTokenPlan('invalid-token')).toBe('free')
  })

  it('should fallback to pro for legacy ie_ tokens', () => {
    expect(getTokenPlan('ie_abc123def456ghi7')).toBe('pro')
  })
})

describe('token cross-platform compatibility', () => {
  it('can generate and verify in sequence', () => {
    for (let i = 0; i < 10; i++) {
      const token = generateToken({ plan: 'pro', subject: `user_${i}` })
      const result = verifyToken(token)
      expect(result.valid).toBe(true)
      expect(result.payload?.sub).toBe(`user_${i}`)
    }
  })
})

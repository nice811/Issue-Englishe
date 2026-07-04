import { NextRequest, NextResponse } from 'next/server'
import { isValidPaidToken, getTokenQuota, verifyToken, verifyTokenWithDevice } from '../../../lib/token'
import { isTokenRevoked } from '../../../lib/revocation'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, fingerprint } = body

    if (!token || token.trim().length === 0) {
      return NextResponse.json({
        valid: false,
        isPro: false,
        message: 'No token provided'
      })
    }

    const trimmed = token.trim()

    if (!isValidPaidToken(trimmed)) {
      return NextResponse.json({
        valid: false,
        isPro: false,
        message: 'Token is not recognized'
      })
    }

    // 吊销检查
    if (await isTokenRevoked(trimmed)) {
      return NextResponse.json({
        valid: false,
        isPro: false,
        message: '该令牌已被吊销',
        revoked: true
      })
    }

    // 设备绑定校验
    const result = verifyTokenWithDevice(trimmed, fingerprint)

    if (!result.valid || !result.payload) {
      return NextResponse.json({
        valid: false,
        isPro: false,
        message: result.error || 'Token is invalid or expired'
      })
    }

    const quota = getTokenQuota(trimmed)
    const isPro = result.payload.plan === 'pro' || result.payload.plan === 'enterprise'
    const deviceBound = !!result.payload.devHash

    return NextResponse.json({
      valid: true,
      isPro,
      plan: result.payload.plan,
      quota,
      expiresAt: result.payload.exp,
      issuedAt: result.payload.iat,
      deviceBound
    })

  } catch (err) {
    console.error('[validate-token] Error:', err)
    return NextResponse.json({
      valid: false,
      isPro: false,
      message: 'Validation error'
    })
  }
}
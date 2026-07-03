import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '../../../../lib/admin-auth'
import { verifyToken } from '../../../../lib/token'

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const token = body.token

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const result = verifyToken(token)

    if (!result.valid) {
      return NextResponse.json({ 
        valid: false,
        error: result.error || 'Invalid token'
      }, { status: 400 })
    }

    return NextResponse.json({
      valid: true,
      plan: result.payload?.plan || 'pro',
      expiresAt: result.payload?.exp ? result.payload.exp * 1000 : 0,
      createdAt: result.payload?.iat ? result.payload.iat * 1000 : 0,
      devHash: result.payload?.devHash || null
    })
  } catch (error) {
    console.error('Verify token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
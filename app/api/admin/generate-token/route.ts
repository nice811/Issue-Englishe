import { NextRequest, NextResponse } from 'next/server'
import { generateToken, verifyToken } from '../../../../lib/token'

export const dynamic = 'force-dynamic'

function verifyAdmin(req: NextRequest): boolean {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) return false

  const headerKey = req.headers.get('x-admin-key')
  const queryKey = new URL(req.url).searchParams.get('admin_key')

  const providedKey = headerKey || queryKey
  if (!providedKey) return false

  return providedKey === adminKey
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyAdmin(req)) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Admin access required.' },
        { status: 401 }
      )
    }

    const body = await req.json()

    const plan = body.plan || 'pro'
    if (!['pro', 'enterprise'].includes(plan)) {
      return NextResponse.json(
        { error: 'INVALID_PLAN', message: 'Plan must be pro or enterprise.' },
        { status: 400 }
      )
    }

    const token = generateToken({
      subject: body.subject,
      plan: plan as 'pro' | 'enterprise',
      tier: body.tier || 'standard',
      validDays: body.validDays || 365,
      generateQuota: body.generateQuota,
      expandQuota: body.expandQuota,
      meta: body.meta
    })

    const verification = verifyToken(token)

    return NextResponse.json({
      token,
      plan,
      valid: verification.valid,
      payload: verification.payload,
      expiresAt: verification.payload?.exp
        ? new Date(verification.payload.exp * 1000).toISOString()
        : null
    })
  } catch (err) {
    console.error('[admin/generate-token] Error:', err)
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Internal server error.' },
      { status: 500 }
    )
  }
}

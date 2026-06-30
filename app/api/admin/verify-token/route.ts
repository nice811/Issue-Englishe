import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getTokenPlan, getTokenQuota } from '../../../../lib/token'

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
    const { token } = body

    if (!token) {
      return NextResponse.json(
        { error: 'TOKEN_REQUIRED', message: 'Token is required.' },
        { status: 400 }
      )
    }

    const verification = verifyToken(token)

    return NextResponse.json({
      valid: verification.valid,
      error: verification.error,
      plan: getTokenPlan(token),
      quota: getTokenQuota(token),
      payload: verification.payload,
      expiresAt: verification.payload?.exp
        ? new Date(verification.payload.exp * 1000).toISOString()
        : null,
      issuedAt: verification.payload?.iat
        ? new Date(verification.payload.iat * 1000).toISOString()
        : null
    })
  } catch (err) {
    console.error('[admin/verify-token] Error:', err)
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Internal server error.' },
      { status: 500 }
    )
  }
}

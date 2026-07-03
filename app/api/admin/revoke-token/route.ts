import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '../../../../lib/admin-auth'
import { revokeToken, restoreToken, listRevokedTokens, isTokenRevoked } from '../../../../lib/revocation'

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const token = body.token
    const reason = body.reason || '手动吊销'

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    if (isTokenRevoked(token)) {
      return NextResponse.json({ error: 'Token already revoked' }, { status: 400 })
    }

    revokeToken(token, reason)

    return NextResponse.json({ success: true, token })
  } catch (error) {
    console.error('Revoke token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const token = body.token

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const success = restoreToken(token)

    if (!success) {
      return NextResponse.json({ error: 'Token not found in revoked list' }, { status: 404 })
    }

    return NextResponse.json({ success: true, token })
  } catch (error) {
    console.error('Restore token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const revoked = listRevokedTokens()
    return NextResponse.json(revoked)
  } catch (error) {
    console.error('List revoked tokens error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
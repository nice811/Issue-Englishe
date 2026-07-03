import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '../../../../lib/admin-auth'
import { generateToken } from '../../../../lib/token'

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const plan = body.plan || 'pro'
    const days = body.days || 30

    if (!['pro', 'enterprise'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    if (days < 1 || days > 365) {
      return NextResponse.json({ error: 'Days must be between 1 and 365' }, { status: 400 })
    }

    const token = generateToken({
      plan: plan as 'pro' | 'enterprise',
      validDays: days
    })

    return NextResponse.json({ token, plan, expiresInDays: days })
  } catch (error) {
    console.error('Generate token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
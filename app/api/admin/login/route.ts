import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '../../../../lib/admin-auth'

/**
 * 管理员登录端点。
 * 仅验证 ADMIN_API_KEY 是否正确，不涉及令牌验证。
 * 返回 200 表示密钥正确，401 表示密钥错误。
 */
export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}

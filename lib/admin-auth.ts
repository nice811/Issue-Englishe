import crypto from 'crypto'
import { NextRequest } from 'next/server'

/**
 * 安全的管理员密钥验证。
 *
 * 安全措施：
 * 1. 仅接受 header（x-admin-key）传递密钥，拒绝 query 参数（避免日志/历史泄露）
 * 2. 使用 crypto.timingSafeEqual 常量时间比对，防止时序攻击
 * 3. 长度不一致时直接返回 false（仍走常量时间路径避免信息泄露）
 */
export function verifyAdmin(req: NextRequest): boolean {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) return false

  // 仅从 header 读取，不再支持 query 参数（安全要求）
  const providedKey = req.headers.get('x-admin-key')
  if (!providedKey) return false

  // 常量时间比对，防止时序攻击
  const a = Buffer.from(providedKey)
  const b = Buffer.from(adminKey)
  if (a.length !== b.length) {
    // 长度不同也要走完比对，避免通过响应时间推断长度
    crypto.timingSafeEqual(a, a)
    return false
  }
  return crypto.timingSafeEqual(a, b)
}
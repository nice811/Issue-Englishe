import fs from 'fs'
import path from 'path'

// 令牌吊销黑名单 - 基于 JSON 文件持久化存储
// 生产环境建议替换为数据库，此处为轻量级方案

const REVOKED_FILE = path.join(process.cwd(), '.revoked-tokens.json')

interface RevokedTokenEntry {
  token: string
  revokedAt: number
  reason?: string
}

let revokedCache: RevokedTokenEntry[] | null = null

function loadRevoked(): RevokedTokenEntry[] {
  if (revokedCache !== null) return revokedCache

  try {
    if (fs.existsSync(REVOKED_FILE)) {
      const data = fs.readFileSync(REVOKED_FILE, 'utf8')
      const parsed = JSON.parse(data)
      revokedCache = Array.isArray(parsed) ? parsed : []
    } else {
      revokedCache = []
    }
  } catch {
    revokedCache = []
  }
  return revokedCache
}

function saveRevoked(list: RevokedTokenEntry[]): void {
  revokedCache = list
  try {
    fs.writeFileSync(REVOKED_FILE, JSON.stringify(list, null, 2), 'utf8')
  } catch (err) {
    console.error('[revocation] Failed to save revoked tokens:', err)
  }
}

// 吊销令牌
export function revokeToken(token: string, reason?: string): void {
  const trimmed = token.trim()
  if (!trimmed) return

  const list = loadRevoked()
  // 避免重复
  if (list.some(e => e.token === trimmed)) return

  list.push({
    token: trimmed,
    revokedAt: Math.floor(Date.now() / 1000),
    reason
  })
  saveRevoked(list)
}

// 检查令牌是否已被吊销
export function isTokenRevoked(token: string): boolean {
  const trimmed = token.trim()
  if (!trimmed) return false

  const list = loadRevoked()
  return list.some(e => e.token === trimmed)
}

// 获取所有已吊销令牌列表
export function listRevokedTokens(): RevokedTokenEntry[] {
  return loadRevoked()
}

// 恢复令牌（从黑名单移除）
export function restoreToken(token: string): boolean {
  const trimmed = token.trim()
  if (!trimmed) return false

  const list = loadRevoked()
  const filtered = list.filter(e => e.token !== trimmed)

  if (filtered.length !== list.length) {
    saveRevoked(filtered)
    return true
  }
  return false
}
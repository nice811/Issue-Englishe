import fs from 'fs'
import path from 'path'

// 令牌吊销黑名单 - 支持环境变量和本地文件两种持久化方式
// Vercel 无服务器环境下使用环境变量 REVOKED_TOKENS 存储
// 本地开发环境使用 .revoked-tokens.json 文件

const REVOKED_FILE = path.join(process.cwd(), '.revoked-tokens.json')

interface RevokedTokenEntry {
  token: string
  revokedAt: number
  reason?: string
}

let revokedCache: RevokedTokenEntry[] | null = null

function parseEnvRevoked(): RevokedTokenEntry[] {
  const envVal = process.env.REVOKED_TOKENS
  if (!envVal || envVal.trim() === '') return []
  try {
    const parsed = JSON.parse(envVal)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadRevoked(): RevokedTokenEntry[] {
  if (revokedCache !== null) return revokedCache

  const envList = parseEnvRevoked()

  try {
    if (fs.existsSync(REVOKED_FILE)) {
      const data = fs.readFileSync(REVOKED_FILE, 'utf8')
      const parsed = JSON.parse(data)
      const fileList = Array.isArray(parsed) ? parsed : []
      // 合并环境变量和文件中的列表，去重
      const merged = [...envList]
      for (const item of fileList) {
        if (!merged.some(m => m.token === item.token)) {
          merged.push(item)
        }
      }
      revokedCache = merged
    } else {
      revokedCache = envList
    }
  } catch {
    revokedCache = envList
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
  console.log('[revocation] NOTE: 吊销令牌已保存到本地文件。部署到Vercel时请将以下内容添加到环境变量 REVOKED_TOKENS:')
  console.log(JSON.stringify(list))
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
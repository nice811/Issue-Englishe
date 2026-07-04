import fs from 'fs'
import path from 'path'
import { kv, kvEnabled } from './kv'

const REVOKED_FILE = path.join(process.cwd(), '.revoked-tokens.json')
const REVOKED_KEY = 'revoked_tokens'

interface RevokedTokenEntry {
  token: string
  revokedAt: number
  reason?: string
}

let revokedCache: RevokedTokenEntry[] | null = null

async function loadFromKV(): Promise<RevokedTokenEntry[]> {
  try {
    const data = await kv.get<RevokedTokenEntry[]>(REVOKED_KEY)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function loadFromFile(): RevokedTokenEntry[] {
  try {
    if (fs.existsSync(REVOKED_FILE)) {
      const data = fs.readFileSync(REVOKED_FILE, 'utf8')
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    }
  } catch {
    // ignore
  }
  return []
}

async function saveToKV(list: RevokedTokenEntry[]): Promise<void> {
  try {
    await kv.set(REVOKED_KEY, list)
  } catch (err) {
    console.error('[revocation] Failed to save to KV:', err)
  }
}

function saveToFile(list: RevokedTokenEntry[]): void {
  try {
    fs.writeFileSync(REVOKED_FILE, JSON.stringify(list, null, 2), 'utf8')
  } catch (err) {
    console.error('[revocation] Failed to save to file:', err)
  }
}

export async function loadRevoked(): Promise<RevokedTokenEntry[]> {
  if (revokedCache !== null) return revokedCache

  const isKvEnabled = await kvEnabled()
  
  if (isKvEnabled) {
    revokedCache = await loadFromKV()
  } else {
    revokedCache = loadFromFile()
  }
  
  return revokedCache
}

async function saveRevoked(list: RevokedTokenEntry[]): Promise<void> {
  revokedCache = list
  
  const isKvEnabled = await kvEnabled()
  
  if (isKvEnabled) {
    await saveToKV(list)
  } else {
    saveToFile(list)
  }
}

export async function revokeToken(token: string, reason?: string): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) return

  const list = await loadRevoked()
  if (list.some(e => e.token === trimmed)) return

  list.push({
    token: trimmed,
    revokedAt: Math.floor(Date.now() / 1000),
    reason
  })
  await saveRevoked(list)
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  const trimmed = token.trim()
  if (!trimmed) return false

  const list = await loadRevoked()
  return list.some(e => e.token === trimmed)
}

export async function listRevokedTokens(): Promise<RevokedTokenEntry[]> {
  return await loadRevoked()
}

export async function restoreToken(token: string): Promise<boolean> {
  const trimmed = token.trim()
  if (!trimmed) return false

  const list = await loadRevoked()
  const filtered = list.filter(e => e.token !== trimmed)

  if (filtered.length !== list.length) {
    await saveRevoked(filtered)
    return true
  }
  return false
}
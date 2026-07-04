import { createClient } from '@vercel/kv'

export const kv = createClient({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
})

export async function kvEnabled(): Promise<boolean> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return false
  }
  try {
    await kv.ping()
    return true
  } catch {
    return false
  }
}
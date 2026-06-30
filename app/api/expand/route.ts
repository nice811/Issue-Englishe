import { NextRequest, NextResponse } from 'next/server'
import { isValidPaidToken, getTokenQuota, verifyToken } from '../../../lib/token'

export const dynamic = 'force-dynamic'

const FREE_DAILY_EXPAND_LIMIT = 1
const PRO_DEFAULT_EXPAND_LIMIT = 50
const DAY_MS = 24 * 60 * 60 * 1000

interface CounterEntry {
  count: number
  resetAt: number
}

const freeExpandCounter = new Map<string, CounterEntry>()
const tokenExpandCounter = new Map<string, CounterEntry>()

function incrementAndCheck(
  counter: Map<string, CounterEntry>,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterMs: number; resetAt: number; count: number } {
  const now = Date.now()
  const entry = counter.get(key)

  if (!entry || entry.resetAt <= now) {
    counter.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0, resetAt: now + windowMs, count: 1 }
  }

  if (entry.count >= limit) {
    const retryMs = entry.resetAt - now
    return { allowed: false, remaining: 0, retryAfterMs: retryMs, resetAt: entry.resetAt, count: entry.count }
  }

  entry.count += 1
  counter.set(key, entry)
  return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0, resetAt: entry.resetAt, count: entry.count }
}

function getClientKey(req: NextRequest, body: any): { ip: string; fingerprint: string; token: string } {
  const ip = (body.client?.ipHash && body.client.ipHash.length > 0)
    ? body.client.ipHash
    : (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
  const fingerprint = body.fingerprint || body.client?.fingerprint || 'no-fp'
  const token = body.token || ''
  return { ip, fingerprint, token }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { description, title, spelling = 'us' } = body

    const { ip, fingerprint, token } = getClientKey(req, body)

    const isPro = token && isValidPaidToken(token)

    let currentLimit = FREE_DAILY_EXPAND_LIMIT
    let counterToCheck = freeExpandCounter
    let keyToCheck = ip + '|' + fingerprint

    if (isPro) {
      const quota = getTokenQuota(token)
      currentLimit = quota.expand === -1 ? PRO_DEFAULT_EXPAND_LIMIT : (quota.expand > 0 ? quota.expand : PRO_DEFAULT_EXPAND_LIMIT)
      counterToCheck = tokenExpandCounter
      keyToCheck = token
    }

    const dailyCheck = incrementAndCheck(counterToCheck, keyToCheck, currentLimit, DAY_MS)
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        {
          error: 'EXPAND_LIMIT_REACHED',
          message: isPro
            ? `Daily expand limit reached (${currentLimit}/day). Resets in ${Math.ceil(dailyCheck.retryAfterMs / 60000)} minutes.`
            : `Free daily expand limit reached (${FREE_DAILY_EXPAND_LIMIT}/day). Upgrade to Pro for more.`,
          isPro,
          limit: currentLimit,
          used: dailyCheck.count,
          resetsInMinutes: Math.ceil(dailyCheck.retryAfterMs / 60000)
        },
        { status: 402 }
      )
    }

    if (!description || description.length < 10) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'Description must be at least 10 characters.' },
        { status: 400 }
      )
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API_KEY_MISSING', message: 'Server configuration error.' },
        { status: 500 }
      )
    }

    const spellingWord = spelling === 'uk' ? 'British' : 'American'

    const systemPrompt = `You are an expert GitHub issue writer. Expand the given short description into a detailed, well-structured paragraph of 80-120 words.

Rules:
- Output ONLY the expanded description paragraph, nothing else.
- Use ${spellingWord} English spelling.
- Keep it factual and objective — no speculation.
- Add implied context: likely impact, affected users, when it occurs.
- Do NOT add markdown headers or bullet points. Just a single flowing paragraph.
- Do NOT invent specific version numbers, error codes, or details not provided.
- Use phrases like "appears to occur when", "seems to affect", "likely impacts" to stay truthful.`

    const userPrompt = `Title: ${title || 'Untitled'}
Short description: ${description}

Please expand this into a detailed description paragraph (80-120 words) suitable for a GitHub issue.`

    const startTime = Date.now()

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    const costMs = Date.now() - startTime

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      console.error('[expand] DeepSeek error:', resp.status, errText)
      return NextResponse.json(
        { error: 'API_ERROR', message: `AI service error (${resp.status}). Please try again.` },
        { status: 502 }
      )
    }

    const data = await resp.json()
    const expanded = (data.choices?.[0]?.message?.content || '').trim()
    const tokens = data.usage?.total_tokens || 0

    if (!expanded || expanded.length < 20) {
      return NextResponse.json(
        { error: 'EMPTY_RESPONSE', message: 'AI returned empty response. Please try again.' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      expanded,
      originalLength: description.length,
      expandedLength: expanded.length,
      isPro,
      usage: {
        used: dailyCheck.count,
        limit: currentLimit,
        remaining: dailyCheck.remaining
      },
      cost: {
        tokens,
        ms: costMs,
      },
    })
  } catch (err) {
    console.error('[expand] Unexpected error:', err)
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Internal server error.' },
      { status: 500 }
    )
  }
}

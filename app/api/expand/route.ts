import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ============ 水印判定 ============
function isValidPaidToken(token?: string): boolean {
  if (!token || token.trim().length === 0) return false
  const trimmed = token.trim()
  if (trimmed.startsWith('ie_') && trimmed.length >= 16) return true
  if (trimmed.length >= 32 && /^[A-Za-z0-9_\-]+$/.test(trimmed)) return true
  return false
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { description, title, token, spelling = 'us' } = body

    // 验证 Pro 权限
    if (!isValidPaidToken(token)) {
      return NextResponse.json(
        { error: 'PRO_REQUIRED', message: 'Smart expand is a Pro feature. Upgrade to unlock.' },
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
import { NextRequest, NextResponse } from 'next/server'
import { isValidPaidToken, getTokenQuota, verifyToken, verifyTokenWithDevice } from '../../../lib/token'
import { isTokenRevoked } from '../../../lib/revocation'

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
    const { description, title, lang } = body

    const { ip, fingerprint, token } = getClientKey(req, body)

    const isPro = token && isValidPaidToken(token)
    const isEnglish = lang === 'en'

    let currentLimit = FREE_DAILY_EXPAND_LIMIT
    let counterToCheck = freeExpandCounter
    let keyToCheck = ip + '|' + fingerprint

    if (isPro) {
      // 吊销检查
      if (await isTokenRevoked(token)) {
        return NextResponse.json(
          {
            error: isEnglish ? 'Token revoked' : '令牌已吊销',
            message: isEnglish ? 'This token has been revoked. Contact support for assistance.' : '该令牌已被吊销，如有疑问请联系支持。',
            isPro: false
          },
          { status: 403 }
        )
      }
      // 设备绑定校验
      const deviceCheck = verifyTokenWithDevice(token, fingerprint)
      if (!deviceCheck.valid) {
        let deviceError = isEnglish ? 'This token is bound to another device.' : '该令牌已绑定到其他设备。'
        if (deviceCheck.error === 'DEVICE_MISMATCH') {
          deviceError = isEnglish ? 'This token is bound to another device and can only be used there.' : '该令牌已绑定到其他设备，只能在绑定设备上使用。'
        } else if (deviceCheck.error === 'EXPIRED') {
          deviceError = isEnglish ? 'This token has expired.' : '该令牌已过期。'
        } else if (deviceCheck.error === 'NOT_YET_VALID') {
          deviceError = isEnglish ? 'This token is not yet valid.' : '该令牌尚未生效。'
        }
        return NextResponse.json(
          {
            error: isEnglish ? 'Device mismatch' : '设备不匹配',
            message: deviceError,
            isPro: false
          },
          { status: 403 }
        )
      }
      const quota = getTokenQuota(token)
      currentLimit = quota.expand === -1 ? PRO_DEFAULT_EXPAND_LIMIT : (quota.expand > 0 ? quota.expand : PRO_DEFAULT_EXPAND_LIMIT)
      counterToCheck = tokenExpandCounter
      keyToCheck = token
    }

    const dailyCheck = incrementAndCheck(counterToCheck, keyToCheck, currentLimit, DAY_MS)
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        {
          error: isEnglish ? 'Expand limit reached' : '扩充额度已达',
          message: isPro
            ? (isEnglish ? `Daily expand limit reached (${currentLimit} uses/day). Resets in approximately ${Math.ceil(dailyCheck.retryAfterMs / 60000)} minutes.` : `已达到今日扩充上限（${currentLimit} 次/天）。约 ${Math.ceil(dailyCheck.retryAfterMs / 60000)} 分钟后重置。`)
            : (isEnglish ? `Free daily expand limit reached (${FREE_DAILY_EXPAND_LIMIT} use/day). Upgrade to Pro for more expansions.` : `免费版每日扩充已达上限（${FREE_DAILY_EXPAND_LIMIT} 次/天）。升级 Pro 获取更多扩充次数。`),
          isPro,
          limit: currentLimit,
          used: dailyCheck.count,
          resetsInMinutes: Math.ceil(dailyCheck.retryAfterMs / 60000)
        },
        { status: 402 }
      )
    }

    if (!description || description.trim().length < 5) {
      return NextResponse.json(
        { error: isEnglish ? 'Invalid input' : '输入无效', message: isEnglish ? 'Description must be at least 5 characters.' : '描述至少需要 5 个字符。' },
        { status: 400 }
      )
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: isEnglish ? 'Configuration error' : '配置错误', message: isEnglish ? 'Server configuration error.' : '服务器配置错误。' },
        { status: 500 }
      )
    }

    const systemPrompt = `你是一位专业的 GitHub Issue 撰写专家。请将用户给出的简短描述扩充为一段详细、结构清晰的中文描述（80-150字）。

规则：
- 只输出扩充后的中文描述段落，不要输出其他任何内容。
- 保持客观事实，不要编造不存在的细节。
- 补充合理的上下文：可能的影响范围、受影响的用户、触发条件、发生频率等。
- 不要添加 markdown 标题或项目符号，只输出一段连贯的文字。
- 不要编造具体的版本号、错误码或未提供的技术细节。
- 使用"可能影响"、"似乎在...时发生"等措辞保持真实性。
- 输出必须保持中文。`

    const userPrompt = `标题：${title || '无标题'}
简短描述：${description}

请将以上简短描述扩充为一段详细的中文描述（80-150字），适合作为 GitHub Issue 的描述部分。`

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
        { error: isEnglish ? 'AI service error' : 'AI 服务错误', message: isEnglish ? `AI service error (${resp.status}). Please try again later.` : `AI 服务错误（${resp.status}），请稍后重试。` },
        { status: 502 }
      )
    }

    const data = await resp.json()
    const expanded = (data.choices?.[0]?.message?.content || '').trim()
    const tokens = data.usage?.total_tokens || 0

    if (!expanded || expanded.length < 20) {
      return NextResponse.json(
        { error: isEnglish ? 'Empty AI response' : 'AI 响应为空', message: isEnglish ? 'AI returned empty response. Please try again later.' : 'AI 返回了空响应，请稍后重试。' },
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
      { error: isEnglish ? 'Server error' : '服务器错误', message: isEnglish ? 'Internal server error.' : '服务器内部错误。' },
      { status: 500 }
    )
  }
}

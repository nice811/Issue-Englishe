import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// ============ 类型定义 ============
interface EnvData {
  os?: string
  appVersion?: string
  deps?: string[]
  logs?: string
}

interface OptionsData {
  spelling: 'us' | 'uk'
  suggestLabels: boolean
}

interface ClientData {
  ipHash?: string
  fingerprint?: string
  session?: string
}

interface GenerateRequest {
  title: string
  description: string
  steps?: string[]
  expected: string
  actual: string
  env?: EnvData
  options?: OptionsData
  client?: ClientData
  token?: string
}

// ============ 限流配置 ============
const ANONYMOUS_DAILY_LIMIT = 10
const TOKEN_DAILY_LIMIT = 200
const IP_WINDOW_MS = 30 * 60 * 1000 // 30 min
const IP_WINDOW_LIMIT = 30
const DAY_MS = 24 * 60 * 60 * 1000

// ============ 内存计数器 ============
interface CounterEntry {
  count: number
  resetAt: number
}

const ipWindowCounter = new Map<string, CounterEntry>()
const anonymousDailyCounter = new Map<string, CounterEntry>()
const tokenDailyCounter = new Map<string, CounterEntry>()

function getClientKey(req: NextRequest, body: GenerateRequest): { ip: string; fingerprint: string; token: string } {
  const ip = (body.client?.ipHash && body.client.ipHash.length > 0)
    ? body.client.ipHash
    : (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
  const fingerprint = body.client?.fingerprint || 'no-fp'
  const token = body.token || ''
  return { ip, fingerprint, token }
}

function incrementAndCheck(
  counter: Map<string, CounterEntry>,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterMs: number; resetAt: number } {
  const now = Date.now()
  const entry = counter.get(key)

  if (!entry || entry.resetAt <= now) {
    counter.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0, resetAt: now + windowMs }
  }

  if (entry.count >= limit) {
    const retryMs = entry.resetAt - now
    return { allowed: false, remaining: 0, retryAfterMs: retryMs, resetAt: entry.resetAt }
  }

  entry.count += 1
  counter.set(key, entry)
  return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0, resetAt: entry.resetAt }
}

// ============ 敏感数据脱敏（用于日志/预览） ============
function sanitizeSensitiveData(text: string): string {
  let result = text

  result = result.replace(
    /(api[-_]?key|secret|token|password|bearer)\s*[:=]?\s*([A-Za-z0-9_\-+]{8,})/gi,
    '$1: [REDACTED]'
  )
  result = result.replace(
    /Authorization:\s*Bearer\s+([A-Za-z0-9_\-\.]+)/gi,
    'Authorization: Bearer [REDACTED]'
  )
  result = result.replace(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    '[REDACTED]'
  )
  result = result.replace(
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
    '[REDACTED]'
  )
  result = result.replace(
    /\b([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    '[REDACTED]'
  )
  result = result.replace(
    /https?:\/\/[^\s:]+:[^\s@]+@[^\s]+/gi,
    '[REDACTED]'
  )

  return result
}

// ============ 输入校验 ============
function validateInput(input: GenerateRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!input.title || input.title.length < 1) {
    errors.push('Title is required (1-120 characters).')
  } else if (input.title.length > 120) {
    errors.push('Title must be at most 120 characters.')
  }

  if (!input.description || input.description.length < 30) {
    errors.push('Description must be at least 30 characters.')
  }

  if (!input.expected || input.expected.length < 10) {
    errors.push('Expected behavior must be at least 10 characters.')
  }

  if (!input.actual || input.actual.length < 10) {
    errors.push('Actual behavior must be at least 10 characters.')
  }

  // Detect un-redacted sensitive data in title/description
  const sensitivePatterns = [
    /(api[-_]?key|secret|token|password|bearer)\s*[:=]?\s*[A-Za-z0-9_\-+]{8,}/i,
    /Authorization:\s*Bearer\s+[A-Za-z0-9_\-\.]+/i,
    /https?:\/\/[^\s:]+:[^\s@]+@[^\s]+/i,
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/
  ]
  const combinedCheck = (input.title || '') + ' ' + (input.description || '')
  for (const pattern of sensitivePatterns) {
    if (pattern.test(combinedCheck)) {
      errors.push('Sensitive data detected. Please redact API keys, tokens, emails, and IP addresses before submitting.')
      break
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============ DeepSeek 客户端初始化 ============
function getDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set')
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  })
}

// ============ 水印权威判定（服务端唯一来源） ============
interface WatermarkCtx {
  token: string
  env: { [key: string]: string | undefined }
}

function isValidPaidToken(token: string): boolean {
  // MVP: accept non-empty tokens that start with "ie_" or pass a simple length check.
  // Production: verify against your billing database / JWT signature / license list.
  if (!token || token.trim().length === 0) return false
  const trimmed = token.trim()
  if (trimmed.startsWith('ie_') && trimmed.length >= 16) return true
  if (trimmed.length >= 32 && /^[A-Za-z0-9_\-]+$/.test(trimmed)) return true
  return false
}

/**
 * determineWatermark — authoritative server-side only.
 * The client is NOT allowed to toggle the watermark on/off.
 */
function determineWatermark(ctx: WatermarkCtx): boolean {
  // Rule 1 — global disable via environment variable
  if (String(ctx.env.FORCE_WATERMARK || '').toLowerCase() === 'off') {
    return false
  }
  // Rule 2 — paid user (valid token) removes watermark
  if (ctx.token && isValidPaidToken(ctx.token)) {
    return false
  }
  // Rule 3 — default on (free tier)
  return true
}

// ============ Markdown 结构校验与合成 ============
function ensureMarkdownIntegrity(text: string): string {
  let cleaned = text

  // Backtick parity — close any unclosed triple-backtick code block
  const backtickCount = (cleaned.match(/```/g) || []).length
  if (backtickCount % 2 !== 0) {
    cleaned = cleaned.trimEnd() + '\n```\n'
  }

  // Trailing whitespace normalization
  cleaned = cleaned.trimEnd() + '\n'
  return cleaned
}

/**
 * composeMarkdown — takes the issue body and optionally appends a watermark footer.
 * 重要：水印只在服务端 composeMarkdown 中追加一次，避免重复。
 */
function composeMarkdown(body: string, opts: { watermark: boolean }): string {
  const cleaned = ensureMarkdownIntegrity(body)
  if (!opts.watermark) return cleaned
  // 单行水印，避免 Markdown 干扰；不重复追加
  return (
    cleaned.trimEnd() +
    '\n\n— Generated by Issue Englisher · https://issue-englisher.vercel.app\n'
  )
}

// ============ 构建 DeepSeek 提示词 ============
// 第一层：System Prompt（角色与原则）
const SYSTEM_PROMPT = `You are a senior open-source maintainer and QA specialist. Generate clean, actionable GitHub issues in English.

CORE PRINCIPLES:
- Be objective and concise, use short sentences
- Never speculate or provide solutions in the issue body
- Never fabricate details not present in user input
- Never expose sensitive data; always redact as [REDACTED]
- Follow GitHub Issue template strictly
- Skip sections with no content; do not leave empty sections
- Preserve technical terms, version numbers, and error messages as-is

REDRESS RULES:
- API keys, secrets, tokens, passwords, emails, IPs => [REDACTED]
- Logs exceeding 2000 chars => truncate and mark [TRUNCATED]
- Unknown frequencies => Unknown (please confirm)

OUTPUT FORMAT:
- Output ONLY the Markdown body
- No explanations or commentary outside the issue
- Use proper GitHub Markdown syntax`

// 第二层：Developer Prompt（格式与检核细则）
function buildDeveloperPrompt(spelling: 'us' | 'uk', watermark: boolean): string {
  const spellingVariant = spelling === 'uk'
    ? 'colour, organise, centre, behaviour, honour, favourite'
    : 'color, organize, center, behavior, honor, favorite'

  return 'FORMAT REQUIREMENTS (STRICT):\n' +
    '\n' +
    '1. TITLE (MUST be first line, max 80 characters)\n' +
    '   - Include affected module or area\n' +
    '   - Format: "Area: Brief description of the issue"\n' +
    '   - Example: "Auth: Login fails with valid credentials"\n' +
    '   - CRITICAL: Title must be plain text on the FIRST line\n' +
    '\n' +
    '2. STRUCTURE (mandatory sections in order):\n' +
    '   Summary\n' +
    '   Steps to Reproduce\n' +
    '   Expected Behavior\n' +
    '   Actual Behavior\n' +
    '   Environment\n' +
    '   Additional Context (optional)\n' +
    '   Labels (suggested)\n' +
    '\n' +
    '3. SUMMARY\n' +
    '   - Brief, factual description of the issue\n' +
    '   - No speculation or solutions\n' +
    '   - Max 2-3 sentences\n' +
    '\n' +
    '4. STEPS TO REPRODUCE\n' +
    '   - Use numbered list (1., 2., 3.)\n' +
    '   - If user did not provide: output "Provide a minimal repro."\n' +
    '   - Never leave numbered steps empty\n' +
    '\n' +
    '5. REPRO FREQUENCY (required, separate line after Steps)\n' +
    '   - Format: "Repro frequency: always | often | rarely | unknown"\n' +
    '   - Example: "Repro frequency: always"\n' +
    '\n' +
    '6. SPELLING\n' +
    '   - Use ' + (spelling === 'uk' ? 'British' : 'American') + ' English consistently\n' +
    '   - Key variants: ' + spellingVariant + '\n' +
    '   - Keep technical terms in original form\n' +
    '\n' +
    '7. SENSITIVE DATA HANDLING\n' +
    '   - API keys/tokens: "api_key: [REDACTED]"\n' +
    '   - Passwords: "password: [REDACTED]"\n' +
    '   - Emails: "[REDACTED]"\n' +
    '   - IPs: "[REDACTED]"\n' +
    '   - If logs exceed 2000 chars: truncate and add "[TRUNCATED]"\n' +
    '\n' +
    '8. CODE BLOCKS\n' +
    '   - Use triple backticks with language hint (bash, json, etc.)\n' +
    '   - Always close code blocks properly\n' +
    '\n' +
    '9. LIST CONTINUITY\n' +
    '   - Numbered lists must be sequential (1., 2., 3.)\n' +
    '   - Bullet lists use hyphen (-)\n' +
    '\n' +
    '10. WATERMARK (do NOT add watermark in output)\n' +
    '   - Never add watermark in your response; the server will append it\n' +
    '\n' +
    '11. LABELS (minimal, no duplicates)\n' +
    '    - Use only 2-4 most relevant labels\n' +
    '    - Common formats: bug, area/<module>, priority/<level>, needs-triage\n' +
    '    - Avoid redundant labels\n' +
    '\n' +
    '12. UNKNOWN INFORMATION\n' +
    '    - Never leave truly empty; use explicit placeholders\n' +
    '    - Examples:\n' +
    '      - "Repro frequency: unknown"\n' +
    '      - "OS: Unknown - please confirm."\n' +
    '      - "Error message: Not provided"\n'
}

// 第三层：User Prompt（业务数据注入）
interface CompactedInput {
  title: string
  description: string
  steps: string[]
  expected: string
  actual: string
  env: {
    os?: string
    appVersion?: string
    deps?: string[]
    logs?: string
  }
}

function buildUserPrompt(input: GenerateRequest): string {
  const compacted: CompactedInput = {
    title: sanitizeSensitiveData(input.title),
    description: sanitizeSensitiveData(input.description),
    steps: input.steps ? input.steps.map(s => sanitizeSensitiveData(s)) : [],
    expected: sanitizeSensitiveData(input.expected),
    actual: sanitizeSensitiveData(input.actual),
    env: {
      os: input.env?.os,
      appVersion: input.env?.appVersion,
      deps: input.env?.deps,
      logs: input.env?.logs?.slice(0, 2000)
    }
  }

  return `ISSUE DATA:\n\n${JSON.stringify(compacted, null, 2)}\n\nGenerate a GitHub Issue following the system and developer instructions.`;
}

// Few-shot 示例
const FEW_SHOT_EXAMPLES = `
FEW-SHOT EXAMPLES:

--- EXAMPLE 1: Frontend Bug ---
Input: Title: 按钮点击无效, Description: 在提交表单时，确认按钮点击后没有任何反应，也无法取消, Steps: ["打开页面", "填写表单", "点击确认按钮"], Expected: 点击后应该显示加载状态，然后跳转结果页, Actual: 没有任何反应，页面看起来像冻结了一样, Env: {"os": "macOS 14", "appVersion": "2.1.0", "deps": ["react 18.2.0"]}

Output:
Auth: Login button unresponsive after clicking

Summary

Login button becomes unresponsive after clicking. Users cannot submit the form or cancel the action.

Steps to Reproduce

1. Open the login page
2. Fill out the form
3. Click the confirmation button

Repro frequency: unknown

Expected Behavior

Click should trigger loading state, then redirect to result page.

Actual Behavior

No response. Page appears frozen; no visual feedback or navigation occurs.

Environment

- OS: macOS 14
- App Version: 2.1.0
- Dependencies: react 18.2.0

Labels

- bug
- area/frontend
- needs-triage

--- EXAMPLE 2: Backend Error ---
Input: Title: API 请求返回 500 错误, Description: 部署到生产环境后调用 /api/users 接口一直返回 500，内网测试环境正常, Steps: ["curl -X POST https://api.example.com/users", "-H Authorization: Bearer [TOKEN]", "返回 500"], Expected: 返回 200 和用户列表 JSON, Actual: HTTP 500 Internal Server Error, Env: {"os": "Ubuntu 22.04", "appVersion": "3.0.1", "deps": ["node 18.17.0", "express 4.18.2"], "logs": "Error: Cannot read property name of undefined at /app/routes/users.js:45:20"}

Output:
API: /users endpoint returns HTTP 500

Summary

Production API endpoint /api/users returns HTTP 500 error. Same request works correctly in staging environment.

Steps to Reproduce

1. Send POST request to https://api.example.com/users
2. Include Authorization header with Bearer token
3. Observe HTTP 500 response

Repro frequency: always

Expected Behavior

Returns HTTP 200 with user list JSON.

Actual Behavior

HTTP 500 Internal Server Error.

Environment

- OS: Ubuntu 22.04
- App Version: 3.0.1
- Dependencies: node 18.17.0, express 4.18.2

Additional Context

Error log:
Error: Cannot read property name of undefined
    at /app/routes/users.js:45:20

Labels

- bug
- area/api
- priority/high
`

// ============ 标签建议（精简版，避免重复） ============
function suggestLabels(description: string, title: string): string[] {
  const text = (description + ' ' + title).toLowerCase()
  const labels: string[] = []

  // 核心问题类型（只取一个）
  if (/error|crash|fail|exception|panic/.test(text)) {
    labels.push('bug')
  } else if (/feature|request|enhancement|proposal/.test(text)) {
    labels.push('enhancement')
  } else if (/doc|document|readme|docs/.test(text)) {
    labels.push('documentation')
  } else if (/perf|slow|performance|speed|latency/.test(text)) {
    labels.push('performance')
  } else if (/build|compile|install|deploy|bundle/.test(text)) {
    labels.push('build')
  } else if (/security|auth|permission|vulnerability|cve/.test(text)) {
    labels.push('security')
  } else {
    labels.push('bug') // 默认
  }

  // 模块/区域（最多一个）
  if (/\bapi\b|endpoint|rest|graphql/.test(text)) {
    labels.push('area/api')
  } else if (/frontend|front-end|ui\b|css|react|vue|svelte/.test(text)) {
    labels.push('area/frontend')
  } else if (/backend|back-end|server|database|postgres|mysql/.test(text)) {
    labels.push('area/backend')
  } else if (/mobile|ios|android|iphone|ipad/.test(text)) {
    labels.push('area/mobile')
  } else if (/auth|login|logout|credential/.test(text)) {
    labels.push('area/auth')
  }

  // 优先级标记（可选）
  if (/critical|urgent|production down/.test(text)) {
    labels.push('priority/high')
  } else if (/minor|cosmetic|typo/.test(text)) {
    labels.push('priority/low')
  } else {
    labels.push('needs-triage')
  }

  // 限制最多 4 个标签
  return labels.slice(0, 4)
}

// ============ API 路由 ============
export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    const body = await req.json() as GenerateRequest

    // 1) 输入校验
    const validation = validateInput(body)
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: validation.errors },
        { status: 400 }
      )
    }

    // 2) 客户端标识
    const { ip, fingerprint, token } = getClientKey(req, body)

    // 3) 每日额度校验（token vs anonymous）
    let currentLimit = ANONYMOUS_DAILY_LIMIT
    let counterToCheck = anonymousDailyCounter
    let keyToCheck = ip + '|' + fingerprint

    if (token && token.trim().length > 0) {
      if (!isValidPaidToken(token)) {
        return NextResponse.json(
          {
            error: 'INVALID_TOKEN',
            details: ['The provided access token is not recognized. Leave it empty for the free tier or contact support.']
          },
          { status: 401 }
        )
      }
      currentLimit = TOKEN_DAILY_LIMIT
      counterToCheck = tokenDailyCounter
      keyToCheck = token
    }

    const dailyCheck = incrementAndCheck(counterToCheck, keyToCheck, currentLimit, DAY_MS)
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        {
          error: 'PAYMENT_REQUIRED',
          details: [
            `Daily limit reached (${currentLimit}/day).`,
            `Resets in ${Math.ceil(dailyCheck.retryAfterMs / 60000)} minutes.`
          ]
        },
        { status: 402 }
      )
    }

    // 4) IP+指纹 30 分钟滑动窗
    const ipKey = ip + '|' + fingerprint
    const ipCheck = incrementAndCheck(ipWindowCounter, ipKey, IP_WINDOW_LIMIT, IP_WINDOW_MS)
    if (!ipCheck.allowed) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          details: [
            `Rate limit exceeded (${IP_WINDOW_LIMIT} requests / 30 min from this IP + fingerprint).`,
            `Retry after ${Math.ceil(ipCheck.retryAfterMs / 60000)} minutes.`
          ]
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(ipCheck.retryAfterMs / 1000)) } }
      )
    }

    // 5) 水印 — 由服务端权威判定
    const watermark = determineWatermark({ token, env: process.env })
    const spelling = body.options?.spelling || 'us'

    // 6) 调用 DeepSeek API
    const client = getDeepSeekClient()

    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n' + buildDeveloperPrompt(spelling, watermark) },
        { role: 'user', content: buildUserPrompt(body) + FEW_SHOT_EXAMPLES }
      ],
      temperature: 0.3,
      max_tokens: 2048
    })

    const modelOutput = completion.choices[0]?.message?.content?.trim() || ''

    // 7) 结构校验 + 统一追加水印
    const markdown = composeMarkdown(modelOutput, { watermark })

    // 8) 读取当前计数用于回显
    const currentEntry = counterToCheck.get(keyToCheck)
    const countToday = currentEntry ? currentEntry.count : 0

    // 9) 计算 token 使用量
    const promptTokens = completion.usage?.prompt_tokens || 0
    const completionTokens = completion.usage?.completion_tokens || 0
    const totalTokens = promptTokens + completionTokens

    // 10) 返回响应（严格按契约）
    return NextResponse.json({
      markdown,
      watermark,
      labels: suggestLabels(body.description, body.title),
      usage: {
        countToday,
        limit: currentLimit
      },
      cost: {
        tokens: totalTokens,
        ms: Date.now() - startTime
      }
    })

  } catch (error) {
    console.error('[generate] Generation failed:', error)

    const err = error as any

    // 处理 API Key 未设置的错误
    if ((error as Error).message.includes('DEEPSEEK_API_KEY')) {
      return NextResponse.json(
        { error: 'CONFIGURATION_ERROR', details: ['DeepSeek API key is not configured. Please set DEEPSEEK_API_KEY environment variable.'] },
        { status: 500 }
      )
    }

    // 处理 API 调用错误
    if (err?.status === 401 || (err?.message?.includes('Incorrect API key') || err?.message?.includes('Invalid API key'))) {
      return NextResponse.json(
        { error: 'AUTHENTICATION_ERROR', details: ['Invalid DeepSeek API key. Please check your configuration.'] },
        { status: 401 }
      )
    }

    if (err?.status === 429) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', details: ['DeepSeek API rate limit exceeded. Please try again later.'] },
        { status: 429 }
      )
    }

    // 处理网络/连接错误
    if (err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
      return NextResponse.json(
        { error: 'NETWORK_ERROR', details: ['Network connection error. Please try again later.'] },
        { status: 503 }
      )
    }

    // 处理 HTML 响应（可能是重定向或错误页面）
    if (err?.message?.includes('<!DOCTYPE') || err?.message?.includes('<html')) {
      return NextResponse.json(
        { error: 'API_RESPONSE_ERROR', details: ['Received unexpected response from DeepSeek API. Please check your API key and network configuration.'] },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { error: 'GENERATION_FAILED', details: [(error as Error).message] },
      { status: 500 }
    )
  }
}

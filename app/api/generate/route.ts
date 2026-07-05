import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { isValidPaidToken, getTokenQuota, verifyToken, verifyTokenWithDevice } from '../../../lib/token'
import { isTokenRevoked } from '../../../lib/revocation'

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
  lang?: string
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
  const isEnglish = input.lang === 'en'

  if (!input.title || input.title.length < 1) {
    errors.push(isEnglish ? 'Title cannot be empty (1-120 characters).' : '标题不能为空（1-120字符）。')
  } else if (input.title.length > 120) {
    errors.push(isEnglish ? 'Title cannot exceed 120 characters.' : '标题不能超过120字符。')
  }

  if (!input.description || input.description.length < 15) {
    errors.push(isEnglish ? 'Description must be at least 15 characters.' : '问题描述至少需要15个字符。')
  }

  if (!input.expected || input.expected.length < 10) {
    errors.push(isEnglish ? 'Expected behavior must be at least 10 characters.' : '期望行为至少需要10个字符。')
  }

  if (!input.actual || input.actual.length < 10) {
    errors.push(isEnglish ? 'Actual behavior must be at least 10 characters.' : '实际行为至少需要10个字符。')
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
      errors.push(isEnglish ? 'Sensitive data detected. Please redact API keys, tokens, emails, and IP addresses before submitting.' : '检测到敏感数据。请在提交前脱敏 API 密钥、令牌、邮箱和 IP 地址。')
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

/**
 * determineWatermark — authoritative server-side only.
 * The client is NOT allowed to toggle the watermark on/off.
 */
function determineWatermark(ctx: WatermarkCtx): boolean {
  if (String(ctx.env.FORCE_WATERMARK || '').toLowerCase() === 'off') {
    return false
  }
  if (ctx.token && isValidPaidToken(ctx.token)) {
    return false
  }
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
  // 美化水印样式，使用分隔线和优雅的格式
  return (
    cleaned.trimEnd() +
    '\n\n---\n\n_Generated by [Issue Englisher](https://issue-englisher.vercel.app)_\n'
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
    '   - Format: "Repro frequency: always | often | rarely | unknown (please confirm)"\n' +
    '   - When frequency is unknown: use "Repro frequency: unknown (please confirm)"\n' +
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

Repro frequency: unknown (please confirm)

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

// ============ 从 Markdown 中提取 Labels ============
function extractLabelsFromMarkdown(markdown: string): string[] | null {
  const lines = markdown.split('\n')
  let inLabelsSection = false
  const labels: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    
    if (/^Labels\s*$/i.test(trimmed)) {
      inLabelsSection = true
      continue
    }
    
    if (inLabelsSection) {
      if (trimmed === '' || trimmed.startsWith('---') || /^#+\s/.test(trimmed)) {
        break
      }
      
      const labelMatch = trimmed.match(/^[-*]\s+(.+)$/)
      if (labelMatch && labelMatch[1]) {
        labels.push(labelMatch[1].trim())
      }
    }
  }

  return labels.length > 0 ? labels : null
}

// ============ 标签建议（精简版，避免重复) ============
function suggestLabels(description: string, title: string): string[] {
  const text = (description + ' ' + title).toLowerCase()
  const labels: Set<string> = new Set()

  // 核心问题类型（只取一个）
  if (/error|crash|fail|exception|panic/.test(text)) {
    labels.add('bug')
  } else if (/feature|request|enhancement|proposal/.test(text)) {
    labels.add('enhancement')
  } else if (/doc|document|readme|docs/.test(text)) {
    labels.add('documentation')
  } else if (/perf|slow|performance|speed|latency/.test(text)) {
    labels.add('performance')
  } else if (/build|compile|install|deploy|bundle/.test(text)) {
    labels.add('build')
  } else if (/security|auth|permission|vulnerability|cve/.test(text)) {
    labels.add('security')
  } else {
    labels.add('bug') // 默认
  }

  // 模块/区域（最多一个）
  if (/\bapi\b|endpoint|rest|graphql/.test(text)) {
    labels.add('area/api')
  } else if (/frontend|front-end|ui\b|css|react|vue|svelte/.test(text)) {
    labels.add('area/frontend')
  } else if (/backend|back-end|server|database|postgres|mysql/.test(text)) {
    labels.add('area/backend')
  } else if (/mobile|ios|android|iphone|ipad/.test(text)) {
    labels.add('area/mobile')
  } else if (/auth|login|logout|credential/.test(text)) {
    labels.add('area/auth')
  }

  // 优先级标记（可选）
  if (/critical|urgent|production down/.test(text)) {
    labels.add('priority/high')
  } else if (/minor|cosmetic|typo/.test(text)) {
    labels.add('priority/low')
  } else {
    labels.add('needs-triage')
  }

  // 转换为数组并限制最多 4 个标签
  return Array.from(labels).slice(0, 4)
}

// ============ API 路由 ============
export async function POST(req: NextRequest) {
  const startTime = Date.now()
  let lang = 'zh'

  try {
    const body = await req.json() as GenerateRequest
    lang = body.lang || 'zh'
    const isEnglish = lang === 'en'

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
            error: isEnglish ? 'Invalid token' : '令牌无效',
            details: [isEnglish ? 'Access token not recognized. Leave empty for free tier or contact support.' : '访问令牌无法识别。留空使用免费版，或联系支持获取帮助。']
          },
          { status: 401 }
        )
      }
      // 吊销检查
      if (await isTokenRevoked(token)) {
        return NextResponse.json(
          {
            error: isEnglish ? 'Token revoked' : '令牌已吊销',
            details: [isEnglish ? 'This token has been revoked. Contact support for assistance.' : '该令牌已被吊销，如有疑问请联系支持。']
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
            details: [deviceError]
          },
          { status: 403 }
        )
      }
      const quota = getTokenQuota(token)
      currentLimit = quota.generate > 0 ? quota.generate : TOKEN_DAILY_LIMIT
      counterToCheck = tokenDailyCounter
      keyToCheck = token
    }

    const dailyCheck = incrementAndCheck(counterToCheck, keyToCheck, currentLimit, DAY_MS)
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        {
          error: isEnglish ? 'Limit reached' : '额度已达',
          details: [
            isEnglish ? `Daily limit reached (${currentLimit} uses/day).` : `已达到今日使用上限（${currentLimit} 次/天）。`,
            isEnglish ? `Resets in approximately ${Math.ceil(dailyCheck.retryAfterMs / 60000)} minutes.` : `约 ${Math.ceil(dailyCheck.retryAfterMs / 60000)} 分钟后重置。`
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
          error: isEnglish ? 'Rate limited' : '请求过于频繁',
          details: [
            isEnglish ? `Rate limit: max ${IP_WINDOW_LIMIT} requests per IP + device fingerprint in 30 minutes.` : `限流：该 IP + 设备指纹 30 分钟内最多 ${IP_WINDOW_LIMIT} 次请求。`,
            isEnglish ? `Please retry in ${Math.ceil(ipCheck.retryAfterMs / 60000)} minutes.` : `请 ${Math.ceil(ipCheck.retryAfterMs / 60000)} 分钟后重试。`
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

    // 10) 提取 Labels，优先使用 AI 生成的，保证一致性
    const extractedLabels = extractLabelsFromMarkdown(modelOutput)
    const finalLabels = extractedLabels || suggestLabels(body.description, body.title)

    // 11) 返回响应（严格按契约）
    return NextResponse.json({
      markdown,
      watermark,
      labels: finalLabels,
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
    const isEnglish = lang === 'en'

    const err = error as any

    // 处理 API Key 未设置的错误
    if ((error as Error).message.includes('DEEPSEEK_API_KEY')) {
      return NextResponse.json(
        { 
          error: isEnglish ? 'Configuration error' : '配置错误', 
          details: [isEnglish ? 'DeepSeek API Key is not configured. Please set DEEPSEEK_API_KEY environment variable.' : 'DeepSeek API Key 未配置，请设置 DEEPSEEK_API_KEY 环境变量。'] 
        },
        { status: 500 }
      )
    }

    // 处理 API 调用错误
    if (err?.status === 401 || (err?.message?.includes('Incorrect API key') || err?.message?.includes('Invalid API key'))) {
      return NextResponse.json(
        { 
          error: isEnglish ? 'Authentication failed' : '认证失败', 
          details: [isEnglish ? 'DeepSeek API Key is invalid. Please check your configuration.' : 'DeepSeek API Key 无效，请检查配置。'] 
        },
        { status: 401 }
      )
    }

    if (err?.status === 429) {
      return NextResponse.json(
        { 
          error: isEnglish ? 'Rate limited' : '限流中', 
          details: [isEnglish ? 'DeepSeek API rate limited. Please try again later.' : 'DeepSeek API 触发限流，请稍后重试。'] 
        },
        { status: 429 }
      )
    }

    // 处理网络/连接错误
    if (err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
      return NextResponse.json(
        { 
          error: isEnglish ? 'Network error' : '网络错误', 
          details: [isEnglish ? 'Network connection error. Please try again later.' : '网络连接错误，请稍后重试。'] 
        },
        { status: 503 }
      )
    }

    // 处理 HTML 响应（可能是重定向或错误页面）
    if (err?.message?.includes('<!DOCTYPE') || err?.message?.includes('<html')) {
      return NextResponse.json(
        { 
          error: isEnglish ? 'API response error' : 'API 响应错误', 
          details: [isEnglish ? 'Received unexpected response from DeepSeek API. Please check your API Key and network configuration.' : '收到 DeepSeek API 的异常响应，请检查 API Key 和网络配置。'] 
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { 
        error: isEnglish ? 'Generation failed' : '生成失败', 
        details: [(error as Error).message] 
      },
      { status: 500 }
    )
  }
}

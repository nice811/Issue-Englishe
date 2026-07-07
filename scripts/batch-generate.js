require('dotenv').config()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TOKEN_PREFIX = 'ie_'
const TOKEN_VERSION = 'v1'

function getSecret() {
  const secret = process.env.TOKEN_SECRET
  if (!secret || secret.length < 32) {
    console.error('错误：TOKEN_SECRET 环境变量未设置或长度不足 32 字符')
    process.exit(1)
  }
  return secret
}

function base64urlEncode(buf) {
  return buf.toString('base64url')
}

function sign(payloadStr) {
  const secret = getSecret()
  return crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url')
}

function generateToken(opts = {}) {
  const now = Math.floor(Date.now() / 1000)
  const subject = opts.subject || `user_${crypto.randomBytes(6).toString('hex')}`
  const plan = opts.plan || 'pro'
  const tier = opts.tier || 'standard'
  const validDays = opts.validDays || 30
  const generateQuota = opts.generateQuota ?? 100
  const expandQuota = opts.expandQuota ?? 50

  const payload = {
    sub: subject,
    plan,
    tier,
    iat: now,
    exp: now + validDays * 86400,
    quotas: {
      generate: generateQuota,
      expand: expandQuota
    },
    meta: opts.meta || {}
  }

  if (opts.deviceFingerprint) {
    payload.devHash = opts.deviceFingerprint
  }

  const payloadStr = JSON.stringify(payload)
  const payloadB64 = base64urlEncode(Buffer.from(payloadStr, 'utf-8'))
  const signature = sign(payloadB64)

  return `${TOKEN_PREFIX}${TOKEN_VERSION}_${payloadB64}.${signature}`
}

function main() {
  const args = process.argv.slice(2)
  const count = parseInt(args[0]) || 100
  const plan = args[1] || 'pro'
  const validDays = parseInt(args[2]) || 30
  const generateQuota = parseInt(args[3]) ?? 100
  const expandQuota = parseInt(args[4]) ?? 50

  console.log(`\n=== 批量生成令牌 ===`)
  console.log(`数量: ${count}`)
  console.log(`套餐: ${plan}`)
  console.log(`有效期: ${validDays} 天`)
  console.log(`生成额度: ${generateQuota === -1 ? '无限' : generateQuota}`)
  console.log(`扩充额度: ${expandQuota === -1 ? '无限' : expandQuota}`)
  console.log(`===================\n`)

  const tokens = []
  for (let i = 0; i < count; i++) {
    const token = generateToken({
      plan,
      validDays,
      generateQuota,
      expandQuota
    })
    tokens.push({
      id: i + 1,
      token,
      plan,
      validDays,
      generateQuota: generateQuota === -1 ? 'unlimited' : generateQuota,
      expandQuota: expandQuota === -1 ? 'unlimited' : expandQuota
    })
  }

  const outDir = path.join(__dirname, '..', 'output')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const timestamp = new Date().toISOString().slice(0, 10)
  const csvPath = path.join(outDir, `tokens_${plan}_${count}_${timestamp}.csv`)
  const txtPath = path.join(outDir, `tokens_${plan}_${count}_${timestamp}.txt`)

  const csvContent = [
    'id,token,plan,valid_days,generate_quota,expand_quota',
    ...tokens.map(t => `${t.id},${t.token},${t.plan},${t.validDays},${t.generateQuota},${t.expandQuota}`)
  ].join('\n')

  fs.writeFileSync(csvPath, csvContent, 'utf-8')
  console.log(`✅ CSV 文件已生成: ${csvPath}`)

  const txtContent = tokens.map(t => t.token).join('\n')
  fs.writeFileSync(txtPath, txtContent, 'utf-8')
  console.log(`✅ TXT 文件已生成: ${txtPath}`)

  console.log(`\n📋 使用说明：`)
  console.log(`  - CSV 文件：包含完整信息，可用于独角数卡导入`)
  console.log(`  - TXT 文件：仅令牌列表，方便批量复制`)
  console.log(`  - 上传到独角数卡后台 → 商品管理 → 添加卡密\n`)
}

main()

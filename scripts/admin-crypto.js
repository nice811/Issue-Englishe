#!/usr/bin/env node
/**
 * 管理员文件加密/解密工具
 *
 * 用途：将管理员相关文件加密后提交到公开仓库，部署时解密恢复。
 * 加密密钥来自环境变量 DEPLOY_CRYPTO_KEY（不在仓库中）。
 *
 * 用法：
 *   加密：npm run admin:encrypt
 *   解密：npm run admin:decrypt
 *
 * 部署平台（如 Vercel）配置 DEPLOY_CRYPTO_KEY 环境变量后，
 * 在 build 前执行 npm run admin:decrypt 即可恢复管理员功能。
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// 需要加密的管理员文件清单
const ADMIN_FILES = [
  'app/admin/page.tsx',
  'app/api/admin/generate-token/route.ts',
  'app/api/admin/verify-token/route.ts',
  'app/api/admin/revoke-token/route.ts',
  '令牌生成教程.md'
]

const ENCRYPTED_DIR = '.admin-encrypted'
const MANIFEST_FILE = path.join(ENCRYPTED_DIR, 'manifest.json')

function getCryptoKey() {
  const key = process.env.DEPLOY_CRYPTO_KEY
  if (!key) {
    console.error('❌ 环境变量 DEPLOY_CRYPTO_KEY 未设置')
    console.error('   请设置一个至少 32 字符的随机字符串作为加密密钥')
    console.error('   示例: export DEPLOY_CRYPTO_KEY="your-secret-key-at-least-32-chars"')
    process.exit(1)
  }
  // 派生固定长度密钥（SHA-256 → 32 bytes for AES-256）
  return crypto.createHash('sha256').update(key).digest()
}

function encryptFile(filePath, key) {
  const content = fs.readFileSync(filePath, 'utf8')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex')
  }
}

function decryptFile(entry, key) {
  const iv = Buffer.from(entry.iv, 'hex')
  const data = Buffer.from(entry.data, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}

function encrypt() {
  const key = getCryptoKey()
  if (!fs.existsSync(ENCRYPTED_DIR)) {
    fs.mkdirSync(ENCRYPTED_DIR, { recursive: true })
  }

  const manifest = { version: 1, files: {} }

  for (const file of ADMIN_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  跳过不存在的文件: ${file}`)
      continue
    }
    const encrypted = encryptFile(file, key)
    const relPath = file.replace(/[\\/]/g, '__')
    fs.writeFileSync(path.join(ENCRYPTED_DIR, relPath + '.enc'), encrypted.data)
    manifest.files[file] = { iv: encrypted.iv, encFile: relPath + '.enc' }
    console.log(`✅ 加密: ${file}`)
  }

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
  console.log(`\n📝 清单已写入 ${MANIFEST_FILE}`)
  console.log(`🔒 共加密 ${Object.keys(manifest.files).length} 个文件`)
}

function decrypt() {
  const key = getCryptoKey()
  if (!fs.existsSync(MANIFEST_FILE)) {
    console.error(`❌ 清单文件不存在: ${MANIFEST_FILE}`)
    console.error('   请确认已从仓库拉取 .admin-encrypted/ 目录')
    process.exit(1)
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  let count = 0

  for (const [originalPath, entry] of Object.entries(manifest.files)) {
    const encPath = path.join(ENCRYPTED_DIR, entry.encFile)
    if (!fs.existsSync(encPath)) {
      console.warn(`⚠️  密文文件缺失: ${encPath}`)
      continue
    }
    const encData = fs.readFileSync(encPath, 'utf8')
    const decrypted = decryptFile({ iv: entry.iv, data: encData }, key)

    // 确保目录存在
    const dir = path.dirname(originalPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(originalPath, decrypted)
    console.log(`✅ 解密: ${originalPath}`)
    count++
  }

  console.log(`\n🔓 共解密 ${count} 个文件，管理员功能已恢复`)
}

// 命令行入口
const command = process.argv[2]
if (command === 'encrypt') {
  encrypt()
} else if (command === 'decrypt') {
  decrypt()
} else {
  console.log('用法: node scripts/admin-crypto.js <encrypt|decrypt>')
  process.exit(1)
}

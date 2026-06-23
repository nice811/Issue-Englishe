# Issue Englisher - 部署指南

## 🚀 快速部署

### Vercel 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nice811/Issue-Englishe)

## 🔧 环境变量配置

### 必填变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DEEPSEEK_API_KEY` | `sk-xxx` | DeepSeek API 密钥 |

### 可选变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `FORCE_WATERMARK` | `on` / `off` | 强制启用水印（生产环境建议 `on`） |

### Vercel 配置位置

1. 进入 Vercel 项目 → Settings
2. 选择 Environment Variables
3. 分别为 **Production** 和 **Preview** 环境配置变量

## 📡 健康检查端点

| 端点 | 用途 |
|------|------|
| `GET /api/health` | 基础健康检查 |
| `GET /api/healthz` | Kubernetes 就绪探针 |
| `GET /api/readyz` | 依赖验证检查 |

## 🚦 限流策略

- **免费用户**：每日 10 次调用
- **Pro 用户**：每日 200 次调用
- **IP + 指纹**：双重识别防止滥用

## 🛡️ 安全特性

- ✅ 敏感数据自动检测（API Key、邮箱、IP）
- ✅ 输入长度校验
- ✅ CORS 配置
- ✅ 响应头安全设置

## 📊 监控指标

目标指标：
- P95 延迟 ≤ 3s
- 成功率 ≥ 98%

## 🔄 CI/CD 配置

### 分支保护规则

1. 保护 `main` 分支
2. 要求 PR 审查通过
3. 启用 CI 状态检查

### GitHub Actions 示例

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
```

## 📝 启动命令

```bash
# 开发环境
npm run dev

# 生产构建
npm run build

# 生产启动
npm start
```

## 🌐 域名配置

1. 在 Vercel 配置自定义域名
2. 配置 DNS 记录（CNAME 或 A 记录）
3. 启用 HTTPS（Vercel 自动配置 Let's Encrypt）

## 📁 项目结构

```
├── app/
│   ├── api/
│   │   ├── generate/route.ts    # 核心生成接口
│   │   ├── health/route.ts      # 健康检查
│   │   ├── healthz/route.ts     # 就绪探针
│   │   └── readyz/route.ts      # 依赖验证
│   ├── layout.tsx               # 根布局（SEO配置）
│   └── page.tsx                 # 主页面
├── i18n/                        # 国际化
├── .env.local                   # 本地环境变量
└── next.config.js               # Next.js 配置
```

## 🚨 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| API 返回 HTML | 配置了 `output: 'export'` | 移除该配置 |
| 敏感数据检测失败 | 输入包含 API Key/邮箱/IP | 脱敏后重试 |
| 水印不显示 | `FORCE_WATERMARK=off` | 设置为 `on` |

### 日志查看

```bash
# Vercel 日志
vercel logs

# 本地开发日志
npm run dev  # 控制台输出
```
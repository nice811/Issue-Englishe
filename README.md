# Issue Englisher

> 将中文 Bug 报告一键转换为标准英文 GitHub Issue，内置防驳回校验、敏感数据脱敏、AI 智能扩充。

🌐 **在线体验**：[https://issue-englisher.vercel.app](https://issue-englisher.vercel.app)

---

## ✨ 核心功能

| 功能 | 免费版 | Pro 版 |
|------|--------|--------|
| 中英转换 | ✅ 10 次/天 | ✅ 200 次/天 |
| 防驳回校验 | ✅ | ✅ |
| 敏感数据脱敏 | ✅ | ✅ |
| AI 智能扩充 | ✅ 1 次/天 | ✅ 无限次 |
| 去水印输出 | ❌ | ✅ |
| 英式拼写支持 | ❌ | ✅ |
| 优先技术支持 | ❌ | ✅ |

---

## 🎯 效果演示

### 输入（中文表单）

```
标题：       登录按钮点击无效
问题描述：   在提交登录表单时，确认按钮点击后没有任何反应，
            也无法取消操作，页面看起来像冻结了一样
复现步骤：
  1. 打开登录页面
  2. 填写用户名和密码
  3. 点击确认按钮
期望行为：   点击后应该显示加载状态，然后跳转到结果页
实际行为：   没有任何反应，页面看起来像冻结了一样
环境信息：
  操作系统：    macOS 14
  应用版本：    2.1.0
  依赖：        react 18.2.0
```

### 输出（标准英文 GitHub Issue）

```markdown
Auth: Login button unresponsive after clicking

## Summary

Login button becomes unresponsive after clicking. Users cannot submit
the form or cancel the action. The page appears frozen with no visual
feedback or navigation occurring.

## Steps to Reproduce

1. Open the login page
2. Fill out the form
3. Click the confirmation button

**Repro frequency:** unknown (please confirm)

## Expected Behavior

Click should trigger loading state, then redirect to result page.

## Actual Behavior

No response. Page appears frozen; no visual feedback or navigation occurs.

## Environment

- OS: macOS 14
- App Version: 2.1.0
- Dependencies: react 18.2.0

## Labels

- bug
- area/frontend
- needs-triage
```

---

## 🔒 安全特性

### 敏感数据自动脱敏

输入包含 API Key、邮箱、IP 等敏感信息时，工具会自动替换为 `[REDACTED]`：

```
输入：api_key=sk-abc123def456ghi789，联系 admin@example.com
输出：api_key: [REDACTED]，联系 [REDACTED]
```

### 防驳回校验

描述过短时自动提醒，Pro 版可一键 AI 扩充至 80-150 字：

```
⚠️ 描述偏短（10/50字符），GitHub Issue 容易被驳回
```

---

## 🌐 国际化

支持中英双语界面，一键切换：

- **中文模式**：界面中文，输出英文 Issue
- **英文模式**：界面英文，输出英文 Issue

---

## 🚀 部署

### 环境变量

```bash
# 必填
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TOKEN_SECRET=your-token-secret-at-least-32-chars-long
ADMIN_API_KEY=your-admin-api-key-here

# Vercel KV（令牌吊销持久化，自动配置）
KV_REST_API_URL=https://xxx.upstash.io
KV_REST_API_TOKEN=xxx

# 可选
# FORCE_WATERMARK=off
```

### 技术栈

- **框架**：Next.js 14 (App Router)
- **语言**：TypeScript
- **样式**：Tailwind CSS
- **AI**：DeepSeek API
- **存储**：Vercel KV (Upstash Redis)
- **部署**：Vercel

---

## 📸 截图说明

> 以下截图位置为占位符，请按下方指引自行截图替换

### 主界面演示

`![主界面](docs/screenshot-main.png)`

**截图指引**：
1. 打开 https://issue-englisher.vercel.app
2. 按上方「输入」示例填写中文表单
3. 截取整个页面（左侧中文表单 + 右侧英文输出）

### 防驳回校验

`![防驳回校验](docs/screenshot-anti-reject.png)`

**截图指引**：
1. 在「问题描述」输入少于 50 字符的内容
2. 截取出现橙色警告的区域

### AI 智能扩充

`![AI 智能扩充](docs/screenshot-expand.png)`

**截图指引**：
1. 点击「智能扩充」按钮
2. 截取扩充前后的对比

### 敏感数据脱敏

`![敏感数据脱敏](docs/screenshot-redact.png)`

**截图指引**：
1. 输入包含 API Key、邮箱的内容
2. 点击「生成」
3. 截取输出中 `[REDACTED]` 的部分

---

## 📞 联系我们

- **QQ**：494516063
- **邮箱**：support@issue-englisher.com

---

## 📄 License

MIT

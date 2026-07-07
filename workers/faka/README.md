# Issue Englisher 发卡系统 - Cloudflare Worker

基于 Cloudflare Workers + D1 的零成本自动发卡系统。

## 功能

- **发放卡密** (`POST /issue`)：从未使用的卡密中取出一个发放给用户
- **查询库存** (`GET /stock`)：查看各套餐的剩余库存
- **批量添加卡密** (`POST /admin/add`)：管理员批量导入卡密
- **统计信息** (`GET /admin/stats`)：查看发卡统计数据

## 部署步骤

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

### 3. 创建 D1 数据库

```bash
wrangler d1 create issue-englisher-faka
```

执行后会输出 database ID，复制它并更新 `wrangler.toml` 中的 `database_id`。

### 4. 执行数据库迁移

```bash
wrangler d1 execute issue-englisher-faka --file=./schema.sql
```

### 5. 配置环境变量

编辑 `wrangler.toml`：
- `database_id`：第 3 步获取的 ID
- `ADMIN_KEY`：设置一个强密码用于管理员接口
- `ALLOWED_ORIGINS`：你的前端域名（如 `https://issue-englisher.vercel.app`）

### 6. 部署 Worker

```bash
wrangler deploy
```

部署成功后会得到一个 Worker URL，例如：
```
https://issue-englisher-faka.your-subdomain.workers.dev
```

### 7. 导入卡密

使用批量生成脚本生成卡密后，调用 admin API 导入：

```bash
curl -X POST https://your-worker-url/admin/add \
  -H "Authorization: Bearer your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": ["ie_v1_xxx.yyy", "ie_v1_aaa.bbb"],
    "plan": "pro",
    "validDays": 30
  }'
```

## API 接口说明

### 发放卡密

```http
POST /issue
Content-Type: application/json

{
  "plan": "pro",
  "buyerContact": "user@example.com"
}
```

响应：
```json
{
  "success": true,
  "orderNo": "FK1234567890ABC",
  "card": {
    "token": "ie_v1_xxx.yyy",
    "plan": "pro",
    "validDays": 30,
    "generateQuota": 200,
    "expandQuota": 50
  }
}
```

### 查询库存

```http
GET /stock
```

响应：
```json
{
  "success": true,
  "stock": {
    "pro": 50,
    "enterprise": 10
  }
}
```

### 批量添加卡密（需 Admin Key）

```http
POST /admin/add
Authorization: Bearer your-admin-key
Content-Type: application/json

{
  "tokens": ["ie_v1_xxx.yyy", ...],
  "plan": "pro",
  "validDays": 30,
  "generateQuota": 200,
  "expandQuota": 50
}
```

### 统计信息（需 Admin Key）

```http
GET /admin/stats
Authorization: Bearer your-admin-key
```

## 免费额度

Cloudflare Workers 免费版：
- 每天 100,000 次请求
- 足够支持小规模发卡业务

D1 免费版：
- 每天 100,000 行读取
- 每天 100,000 行写入
- 足够使用

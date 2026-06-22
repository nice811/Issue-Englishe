先给结论：后端能做的 SEO 优化，核心是“让搜索引擎更快、更准地抓取与理解你的页面”，并“把可索引的内容稳定、快速、可结构化地输出”。落到代码与架构，优先级如下（附可直接实施的做法与示例）。

1） 输出可索引的 HTML（避免纯前端渲染空壳）
服务端直出或预渲染：
SSR/SSG:Next.js、Nuxt、SvelteKit，或后端模板引擎（Django/Jinja、Rails ERB、Express+EJS）。
对动态详情页（文章、产品页）使用 on-demand revalidation（按需再生成），兼顾新鲜度与性能。
关键点：首屏 HTML 必须包含主要文本、标题、规范链接与结构化数据，而不是等前端 JS 再注水。

2） 正确返回索引信号（HTTP 级别最关键）
状态码语义化：
200 正常；301/308 永久跳转；410 永久删除；404 真正不存在。
软 404：内容极少或模板页请返回 404/410 或补足内容。
规范化 URL：
在后端统一 trailing slash、大小写、参数顺序，避免重复内容。
返回 Link rel=“canonical” 指向首选 URL;列表分页用 rel=“prev/next”（仅当真的分页）。
国际化：
多语言站点在后端生成 hreflang（含 x-default），并确保各语言互相互链一致。
爬虫控制：
针对不应索引的页面返回 meta robots noindex 或在 robots.txt 屏蔽（更推荐用 meta 控制具体页）。
不要用 200 + noindex 去掩盖错误;该 404 就 404。

3） 结构化数据（Schema.org）后端生成
在 HTML 中嵌入 JSON-LD（后端渲染更稳定）：
常用类型：Article/BlogPosting、Product、FAQPage、HowTo、BreadcrumbList、Organization、Event。
保证三一致：页面可见内容、结构化数据、开放图谱/元信息一致。
FAQ/HowTo 尤其要从后端把 Q/A、步骤列表写进 JSON-LD，避免前端拼装导致抓取不稳定。
校验：部署前用 Rich Results Test/Schema Validator 过一遍。

4) 元信息与可读片段（后端模板强制位）
title、meta description、og：title/description/URL/image、twitter cards、meta robots 由后端模板填充，字段取自数据库或 CMS。
标题唯一、含主要关键词；描述为 120–160 字的自然语句，避免机械拼接。
面包屑（面包屑

（BreadcrumbList）在后端输出有助于站点结构被理解，并提升富结果概率。

5) 可缓存、可刷新：后端与边缘协同
缓存控制
对稳定内容返回 Cache-Control： public， max-age=86400， stale-while-revalidate=600。
动态页使用短缓存 + ETag/Last-Modified，支持条件请求，降低抓取与用户带宽。
变更通知
部署站点地图 sitemap.xml（按类型/日期分片，控制在 50k URL/文件以内），重要内容增量更新;向各搜索引擎 Search Console 主动提交。
关键页面的 on-demand revalidation：当后端数据更新时，触发再生成并清理 CDN 缓存（Surrogate-Key/Tag）。

6) 性能与可用性（搜索也在意用户体验信号）
TTFB/CLS/LCP/FID 指标优化（后端可控部分）：
TTFB：边缘节点部署、数据库连接池、SQL 索引、N+1 查询消除。
LCP：首屏关键图像后端裁剪/压缩（AVIF/WebP）、明确尺寸、预加载关键资源。
CLS：后端输出确定尺寸占位、避免异

置换，减少布局抖动。
FID/INP：后端减少首屏 JS 体积，启用模块化与延迟加载，服务端直出可交互内容，避免阻塞主线程的同步脚本。

7) 日志与监测（用数据闭环指导迭代）
服务端记录并分维度统计：
爬虫访问量与状态码分布（按 UA 分类：Googlebot、Bingbot、常见抓取器）。
关键路由的 TTFB、命中/未命中缓存率、错误率（5xx/4xx）。
sitemap 提交与抓取频率变化。
接入搜索控制台（Google/Bing）：
定期导出“覆盖率/抓取统计/页面体验/增强功能（FAQ、HowTo、产品富结果）”报表，对应到后端路由或模板版本。
监测重写/跳转规则的副作用：
新版 URL 推出后，观察 301 链长、跳转次数、最终目标状态码;避免 301 链环和多跳。

8) 安全与合规（避免被降权的暗坑）
统一返回一致国家/地区版本，避免同一 IP 返回不一致内容（谨慎使用基于 IP 的动态差异）。
对应隐私与同意管理（如需）：确保后端在无同意时不注入跟踪脚本，但不要屏蔽主要内容与核心交互（避免“内容被同意墙挡住”的降质体验）。
避免隐形文本、误导性结构化数据、自动生成且未审校的大规模低质量页面（这些都会导致可见性下降）。

---

9) 多区域与多语言的后端落地做法
URL 策略（推荐二级路径）：/en/， /zh/， /ja/...;统一在后端生成 canonical 与 hreflang，且互链成环。
内容来源：CMS/数据库层面以“语言”为第一维，后端渲染

为“语言”选择相应字段（标题、描述、正文、图像替代文本、结构化数据中的 inLanguage），不要在同一路径下动态切语言内容（避免索引混乱）。
语言检测与切换：
不自动跳转（避免因 IP/Accept-Language 误判导致索引错配）;仅在用户明确选择时 302 到对应 /en 或 /zh 路径。
在 HTML 上声明正确的 lang 与 dir 属性：<html lang=“en”> 或 <html lang=“zh-CN”>;为屏幕阅读器与搜索引擎提供明确信号。
对可切换的拼写风格（US/UK）仅影响生成结果，不影响站点 UI 语言与 URL。

元数据与可分享性（Open Graph/SEO）：
每个语言路径提供独立 <title>、<meta name=“description”> 与 og：locale（如 en_US、zh_CN）。
提供 og：image 与 twitter：card（summary_large_image）展示“前后对比”截图，提升社交点击率。
在英文页面用 <link rel=“alternate” hreflang=“zh-CN” href=“.../zh” /> 互指，反之亦然。

---

提示词规范（Prompting）

系统指令（固定，不暴露给前端）
角色：你是资深开源维护者与技术写作者。
目标：将混合语言的缺陷描述重写为标准英文 GitHub Issue，保持技术名词、版本号与错误信息原样。
输出：仅返回 Markdown，不要外层解释;严格使用给定模板;缺失信息用“Unknown — please confirm.” 占位。

模板变量
{title}， {description}， {steps[]}， {expected}， {actual}， {env.os}， {env.version}， {env.deps[]}， {env.logs}， {spelling}

用户消息（构造示例）
code
Please rewrite the following bug report into a clean, native-English GitHub issue using the template below.
- Keep stack/library names and version numbers unchanged.
- Convert any Chinese into concise engineering English.
- If a section is missing, fill it with "Unknown — please confirm."
- Spelling: {spelling}.

Input:
Title: {title}
Description: {description}
Steps: {steps_joined}
Expected: {expected}
Actual: {actual}
Environment:
- OS: {env.os}
- App/Service version: {env.version}
- Dependencies: {env.deps_joined}
- Logs:
{env.logs}

Template to follow exactly:
Title: <auto-polished title, <=72 chars>

Summary
- One-sentence summary of the problem (plain English).

Steps to Reproduce
1) ...
2) ...
3) ...
Repro frequency: <always/often/rarely/unknown — please confirm.>

Expected Behavior
- ...

Actual Behavior
- ...

Environment
- OS: ...
- App/Service version: ...
- SDK/Dependency versions: ...
- Logs (if any): ...
- Minimal reproducible example: Unknown — please confirm.

Additional Context
- Suspected cause: Unknown — please confirm.
- Related issues/PRs: Unknown — please confirm.
- Labels (suggested): bug, needs-triage, <tech stack>
输出后处理规则（在后端实现）
标题硬阈值：>72 字符则截断到最近空格并追加“...”
步骤编号连续性检查：若生成缺 2) 或乱序，后端重排
代码块闭合：统计 ``` 奇偶并补闭合
拼写风格：us=“behavior， color”，uk=“behaviour， colour”（仅正文词汇，不改专有名词）

---

速率限制与安全

速率限制
匿名：IP+UA 维度 10 req/小时;返回 429 并附 Retry-After
付费：token 维度 200 req/日;突发峰值 10 req/分钟
使用 Cloudflare Rate Limiting 或自建 KV 计数（key： ipHash：YYYYMMDDHH）

输入清洗
脱敏正则：/（API[-]？key|secret|token|password|passwd|授权：\s*承载者\s+[A-Za-z0-9\-\.]+）/i
邮箱/IP：替换为 user@example.com / 203.0.113.0
日志截断：超过 8KB 仅保留首尾 2KB，并标注“截断”

CORS 与来源校验
仅允许你的主域名与预发域名；其他来源 403
OPTIONS 预检缓存 10 分钟

错误分级
上游模型错误：记录 code 与重试一次（指数退避，最大 1 次）
校验失败：直接 400 并返回可读错误字段 keys


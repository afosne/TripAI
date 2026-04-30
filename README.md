# Cloudflare 部署指南

## 前置条件

- Node.js >= 18
- Cloudflare 账户
- 域名（可选，也可用 `*.workers.dev`）

## 1. 安装依赖

```bash
# 根目录
npm install

# 前端
cd frontend && npm install && cd ..
```

## 2. 创建 Cloudflare 资源

### D1 数据库

```bash
npx wrangler d1 create trip
```

输出中会包含 `database_id`，填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

数据库表会在首次请求时自动创建，无需手动执行迁移。

### KV 命名空间

```bash
npx wrangler kv namespace create CACHE
```

输出中会包含 `id`，填入 `wrangler.jsonc` 的 `kv_namespaces[0].id`。

### Queue

Queue 在 `wrangler.jsonc` 中已声明（`ai-processing`），首次 deploy 时自动创建。如果使用队列模式（`AI_MODE=queue`），必须确保 Queue 存在。

## 3. 配置环境变量

### wrangler.jsonc（非敏感配置）

编辑 `wrangler.jsonc` 中的 `vars` 字段：

```jsonc
"vars": {
  // AI 模式：队列或流式
  "AI_MODE": "queue",  // "queue" 或 "stream"（默认）

  // AI 服务（二选一，优先级从上到下）

  // 选项A：自定义模型（如火山引擎豆包）
  "AI_API_KEY": "your-api-key",
  "AI_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3",
  "AI_MODEL": "doubao-pro-32k-241215",

  // 选项B：Cloudflare AI Gateway（备用）
  "AI_GATEWAY_ACCOUNT_ID": "",
  "AI_GATEWAY_ID": "",
  "AI_GATEWAY_TOKEN": "",
  "AI_FALLBACK_MODEL": "",

  // 高德地图
  "AMAP_API_KEY": "your-amap-web-api-key",
  "AMAP_JS_KEY": "your-amap-js-key",       // 前端地图，可选
  "AMAP_JSCODE": "your-amap-js-security",   // 前端地图安全密钥，可选

  // 图片搜索
  "UNSPLASH_ACCESS_KEY": "your-unsplash-key"
}
```

### Secrets（敏感配置，推荐用 CLI 设置）

```bash
# 如果 AI_API_KEY 不想写在 wrangler.jsonc 里：
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
```

通过 `wrangler secret put` 设置的值会覆盖 `vars` 中的同名项。

## 4. AI_MODE 说明

| 值 | 模式 | 说明 |
|---|---|---|
| `queue` | 纯队列 | POST 入队 → 返回 requestId → 前端轮询结果。适合 AI 响应较慢的场景，不会因 Worker 超时断开 |
| `stream` 或不设 | 纯流式 | 直接调用 AI 并 SSE 流式返回。延迟更低，但受 Worker 执行时间限制 |

使用 `queue` 模式需要 Queue 绑定（`AI_QUEUE`）已配置。

## 5. 本地开发

```bash
# 终端1：后端
npm run dev

# 终端2：前端（热更新，代理 /api 到 8787）
cd frontend && npm run dev
```

后端启动在 `http://localhost:8787`，前端在 `http://localhost:5173`。

本地开发如需使用 secrets，创建 `.dev.vars` 文件：

```bash
AI_API_KEY=your-key
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_MODEL=doubao-pro-32k-241215
```

## 6. 部署

```bash
npm run deploy
```

此命令会先构建前端（`cd frontend && npm run build`），然后执行 `wrangler deploy --minify`。

首次部署后，Worker 地址为 `https://aitu.<your-subdomain>.workers.dev`。

## 7. 绑定自定义域名

```bash
npx wrangler domains attach aitu.yourdomain.com
```

或在 Cloudflare Dashboard → Workers → your worker → Settings → Domains & Routes 中添加。

域名需要已托管在 Cloudflare DNS 上。

## 8. 验证部署

```bash
curl https://your-worker.workers.dev/health
```

应返回 `OK`。

## 9. 定时任务

`wrangler.jsonc` 中已配置 cron：

```jsonc
"triggers": {
  "crons": ["0 3 * * *"]
}
```

每天凌晨 3 点自动清理过期/失败的行程数据和孤立记录。需在 Dashboard 中确认 Cron Trigger 已启用。

## 资源清单

| 资源 | 类型 | 用途 |
|---|---|---|
| D1 `trip` | SQLite 数据库 | 行程、评价存储 |
| KV `CACHE` | 键值存储 | 天气缓存、地理编码缓存、AI 结果缓存、短链接 |
| Queue `ai-processing` | 消息队列 | AI 任务异步处理（queue 模式） |
| Cron | 定时任务 | 每日数据清理 |

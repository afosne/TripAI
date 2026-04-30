import {Hono} from 'hono'
import type {CloudflareBindings} from './types'
import {deletePlan, getPlan, initDatabase} from './services/db'
import {resolveAIClient, logAI} from './services/ai-stream'

import miscRoutes from './routes/misc'
import generateRoutes from './routes/generate'
import plansRoutes from './routes/plans'
import interactionRoutes from './routes/interaction'
import mapRoutes from './routes/map'
import attractionRoutes from './routes/attraction'
import socialRoutes from './routes/social'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// 数据库初始化中间件
let dbInitialized = false
app.use('*', async (c, next) => {
  if (!dbInitialized) {
    try {
      await initDatabase(c.env.DB)
      dbInitialized = true
    } catch (e) {
      console.error('数据库初始化失败:', e)
    }
  }
  await next()
})

// 挂载路由模块
app.route('/', miscRoutes)
app.route('/', generateRoutes)
app.route('/', plansRoutes)
app.route('/', interactionRoutes)
app.route('/', mapRoutes)
app.route('/', attractionRoutes)
app.route('/', socialRoutes)

// SPA 前端静态资源回退（必须在最后）
app.get('*', async (c) => {
  return await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
})

// ========== 队列消费者 ==========

type QueueResult = { planId?: string; version?: number; updatePayload?: any } | null

async function processQueueMessage(message: any, env: CloudflareBindings): Promise<QueueResult> {
  const { messages, maxTokens, requestId, planId } = message.body as {
    messages: any[]; maxTokens?: number; requestId: string; planId?: string; editToken?: string
  }
  logAI('queue', 'start', { requestId, planId, msgCount: messages.length, maxTokens })
  let content: string | null = null

  const { client, provider } = resolveAIClient(env)
  const t0 = Date.now()
  try {
    const reqBody: any = { messages, response_format: { type: 'json_object' } }
    if (maxTokens) reqBody.max_tokens = maxTokens
    const data = await client.chatCompletion(reqBody, false, 300_000)
    content = data.choices?.[0]?.message?.content || null
    const usage = data.usage
    logAI(provider, content ? 'completion.ok' : 'completion.empty', { requestId, ms: Date.now() - t0, tokens: usage })
  } catch (e) {
    logAI(provider, 'completion.error', { requestId, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
  }

  if (!content) {
    await env.CACHE.put(`ai-result:${requestId}`, JSON.stringify({ error: 'AI 服务不可用' }), { expirationTtl: 7 * 24 * 60 * 60 })
    logAI('queue', 'failed', { requestId, provider })
    return null
  }

  let dbSaved = false
  let dbUpdate: { planId: string; version: number; updatePayload: any } | null = null
  if (planId) {
    try {
      const itinerary = JSON.parse(content)
      if (itinerary && typeof itinerary === 'object') {
        const existing = await getPlan(env.DB, planId)
        const version = Number(existing?.version) || Date.now()
        const updatePayload: any = {
          itinerary: JSON.stringify({ ...itinerary, status: 'completed' }),
          version: Date.now(),
          is_public: 1,
          status: 'completed',
        }
        if (itinerary.title && /^\[.+]/.test(itinerary.title)) {
          updatePayload.title = itinerary.title
        }
        dbUpdate = { planId, version, updatePayload }
        dbSaved = true
        logAI('queue', 'saved', { requestId, planId, days: itinerary.days?.length })
      }
    } catch (e) {
      logAI('queue', 'save.error', { requestId, planId, error: e instanceof Error ? e.message : String(e) })
    }
  }

  await env.CACHE.put(`ai-result:${requestId}`, JSON.stringify({ content, saved: dbSaved }), { expirationTtl: 7 * 24 * 60 * 60 })
  logAI('queue', 'done', { requestId, contentLen: content.length, saved: dbSaved })
  return dbUpdate
}

export default {
  fetch: app.fetch,
  async queue(batch: any, env: CloudflareBindings, ctx: any) {
    const settled = await Promise.allSettled(
      batch.messages.map((m: any) => processQueueMessage(m, env))
    )
    const results = settled
      .filter((r): r is PromiseFulfilledResult<QueueResult> => r.status === 'fulfilled' && !!r.value)
      .map(r => r.value)

    if (results.length > 0) {
      const stmt = env.DB.prepare(
        'UPDATE plans SET itinerary = ?, version = ?, is_public = COALESCE(?, is_public), title = COALESCE(?, title), status = COALESCE(?, status) WHERE id = ? AND version = ?'
      )
      await env.DB.batch(
        results.map(r => stmt.bind(
          r!.updatePayload.itinerary,
          r!.updatePayload.version,
          r!.updatePayload.is_public ?? null,
          r!.updatePayload.title ?? null,
          r!.updatePayload.status ?? null,
          r!.planId,
          r!.version,
        ))
      )
      logAI('queue', 'batch.saved', { count: results.length })
    }
  },

  async scheduled(_event: any, env: CloudflareBindings, ctx: any) {
    ctx.waitUntil((async () => {
      const now = Date.now()
      const ONE_DAY = 24 * 60 * 60 * 1000
      const results = { d1: { stalePending: 0, staleFailed: 0, orphanReviews: 0, emptyItinerary: 0, expiredCompleted: 0 }, kv: { orphanShortlinks: 0 } }

      const stalePending = await env.DB.prepare(
        `SELECT id FROM plans WHERE itinerary LIKE ? AND created_at < ?`
      ).bind('%"status":"pending"%', now - 3 * ONE_DAY).all()
      for (const row of (stalePending.results || []) as any[]) {
        const plan = await getPlan(env.DB, row.id as string)
        if (!plan) continue
        let it: any
        try { it = JSON.parse(plan.itinerary as string) } catch { continue }
        if (it.status !== 'pending') continue
        await deletePlan(env.DB, row.id as string)
        results.d1.stalePending++
      }

      const staleFailed = await env.DB.prepare(
        `SELECT id FROM plans WHERE itinerary LIKE ? AND created_at < ?`
      ).bind('%"status":"failed"%', now - 3 * ONE_DAY).all()
      for (const row of (staleFailed.results || []) as any[]) {
        const plan = await getPlan(env.DB, row.id as string)
        if (!plan) continue
        let it: any
        try { it = JSON.parse(plan.itinerary as string) } catch { continue }
        if (it.status !== 'failed') continue
        await deletePlan(env.DB, row.id as string)
        results.d1.staleFailed++
      }

      const orphanReviews = await env.DB.prepare(
        `SELECT r.id FROM reviews r LEFT JOIN plans p ON r.plan_id = p.id WHERE p.id IS NULL`
      ).all()
      for (const row of (orphanReviews.results || []) as any[]) {
        await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(row.id as string).run()
        results.d1.orphanReviews++
      }

      let cursor: string | undefined = undefined
      do {
        const list: KVNamespaceListResult<unknown, string> = await env.CACHE.list({ prefix: 'shortlink:', cursor })
        for (const key of list.keys) {
          const planId = await env.CACHE.get(key.name)
          if (!planId) continue
          const plan = await getPlan(env.DB, planId)
          if (!plan) {
            await env.CACHE.delete(key.name)
            results.kv.orphanShortlinks++
          }
        }
        cursor = list.list_complete ? undefined : list.cursor
      } while (cursor)

      console.log('[scheduled] cleanup done:', JSON.stringify(results))
    })())
  },
}

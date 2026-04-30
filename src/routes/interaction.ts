import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { CloudflareBindings } from '../types'
import { getPlan, createReview, getReviews, updatePlanRating, hasUserReviewed } from '../services/db'
import { generateId } from '../utils/plan'
import { resolveAIClient, logAI } from '../services/ai-stream'
import { buildReviseMessages } from '../prompt/revise'

const router = new Hono<{ Bindings: CloudflareBindings }>()

// ========== 评价 ==========

router.post('/api/plans/:id/reviews', async (c) => {
  try {
    const planId = c.req.param('id')
    const reviewData = await c.req.json()
    const { user_id, nickname, email, rating, comment } = reviewData

    if (!user_id || !rating || rating < 1 || rating > 5) {
      return c.json({ error: '无效的参数' }, 400)
    }

    const hasReviewedResult = await hasUserReviewed(c.env.DB, planId, user_id)
    if (hasReviewedResult) return c.json({ error: '您已经评价过此行程' }, 400)

    const reviewId = generateId()
    await createReview(c.env.DB, {
      id: reviewId,
      plan_id: planId,
      user_id: user_id,
      nickname: nickname || '',
      email: email || '',
      rating: rating,
      comment: comment || '',
    })

    await updatePlanRating(c.env.DB, planId)

    return c.json({ success: true, review_id: reviewId })
  } catch (error) {
    console.error('提交评价失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.get('/api/plans/:id/reviews', async (c) => {
  try {
    const planId = c.req.param('id')
    const reviews = await getReviews(c.env.DB, planId)
    return c.json({ reviews: reviews.results || [] })
  } catch (error) {
    console.error('获取评价失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

// ========== 行程修改（AI 重新生成）==========

router.post('/api/plans/:id/revise', async (c) => {
  const planId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const { feedback, target_day, target_index } = body

  if (!feedback || !feedback.trim()) {
    return c.json({ error: '请输入修改意见' }, 400)
  }

  const plan = await getPlan(c.env.DB, planId)
  if (!plan) return c.json({ error: '行程不存在' }, 404)

  const clientToken = c.req.header('X-Edit-Token')
  if (!clientToken || !plan.edit_token || plan.edit_token !== clientToken) {
    return c.json({ error: '无编辑权限，请使用正确的管理链接' }, 403)
  }

  const currentItinerary = JSON.parse(plan.itinerary as string)
  if (!currentItinerary?.days || !Array.isArray(currentItinerary.days)) return c.json({ error: '行程无效' }, 400)

  const params = JSON.parse((plan.params as string) || '{}')
  const city = plan.city || params.destination || ''
  const { client: aiClient, provider } = resolveAIClient(c.env)

  let targetContext = ''
  if (typeof target_day === 'number' && typeof target_index === 'number') {
    const dayData = currentItinerary.days[target_day]
    if (dayData) {
      const dayActivities = dayData.activities?.map((a: any, i: number) => {
        const prefix = i === target_index ? '👉 [当前修改]' : '  '
        return `${prefix}${a.time || ''} ${a.name}（${a.duration}分钟）- ${a.description}`
      }).join('\n') || ''
      targetContext = `\n当前是第${dayData.day}天，当天的安排如下：\n${dayActivities}\n\n用户想修改的是：${dayData.activities?.[target_index]?.name || '第' + (target_index + 1) + '个活动'}`
    }
  } else {
    const daysSummary = currentItinerary.days.map((d: any) => {
      const acts = d.activities?.map((a: any) => `  ${a.time || ''} ${a.name}（${a.duration}分钟）`).join('\n')
      return `第${d.day}天:\n${acts}`
    }).join('\n\n')
    targetContext = `\n当前完整行程：\n${daysSummary}`
  }

  return streamSSE(c, async (stream) => {
    const t0 = Date.now()
    let chunks = 0
    logAI(provider, 'revise.start', { planId, city, feedback })
    try {
      const response = await aiClient.chatStream({
        messages: buildReviseMessages(city, params, targetContext, feedback),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              await stream.writeSSE({ event: 'delta', data: delta })
              chunks++
            }
          } catch { /* skip */ }
        }
      }

      await stream.writeSSE({ event: 'done', data: '{}' })
      logAI(provider, 'revise.ok', { planId, chunks, ms: Date.now() - t0 })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logAI(provider, 'revise.error', { planId, chunks, ms: Date.now() - t0, error: msg })
      await stream.writeSSE({ event: 'error', data: msg })
    }
  })
})

export default router

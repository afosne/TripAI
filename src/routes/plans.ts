import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import { createPlan, getPlan, updatePlanWithOptimisticLock, deletePlan, getPublicPlans, getPlansCount } from '../services/db'
import { generateId, getCurrentTimestamp, validatePlanParams } from '../utils/plan'

const router = new Hono<{ Bindings: CloudflareBindings }>()

router.post('/api/plans', async (c) => {
  try {
    const params = await c.req.json()

    if (!validatePlanParams(params)) {
      return c.json({ error: '无效的参数，请检查目的地和天数' }, 400)
    }

    const planId = generateId()
    const now = getCurrentTimestamp()
    const editToken = crypto.randomUUID().replace(/-/g, '')

    try {
      await createPlan(c.env.DB, {
        id: planId,
        user_id: params.user_id || 'anonymous',
        title: `[${params.destination}] ${typeof params.days === 'string' ? params.days : params.days + '天'}行程`,
        params: JSON.stringify(params),
        itinerary: JSON.stringify({ status: 'pending' }),
        version: 1,
        is_public: 0,
        avg_rating: 0,
        rating_count: 0,
        city: params.destination,
        created_at: now,
        edit_token: editToken,
        status: 'pending',
      })
    } catch (dbError) {
      console.error('数据库写入失败:', dbError)
      return c.json({ error: `创建失败: ${dbError instanceof Error ? dbError.message : String(dbError)}` }, 500)
    }

    return c.json({ plan_id: planId, edit_token: editToken })
  } catch (error) {
    console.error('行程规划提交失败:', error)
    return c.json({ error: `服务器错误: ${error instanceof Error ? error.message : String(error)}` }, 500)
  }
})

router.get('/api/plans/public', async (c) => {
  try {
    const { city, min_rating, sort, limit, offset } = c.req.query()

    const filter = {
      city: city,
      min_rating: min_rating ? parseFloat(min_rating) : undefined,
      sort: sort,
    }

    const plans = await getPublicPlans(c.env.DB, filter, parseInt(limit || '20'), parseInt(offset || '0'))
    const total = await getPlansCount(c.env.DB, filter)

    return c.json({
      plans: plans.results || [],
      total: total,
      limit: parseInt(limit || '20'),
      offset: parseInt(offset || '0'),
    })
  } catch (error) {
    console.error('获取公开方案失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.get('/api/plans/:id', async (c) => {
  try {
    const planId = c.req.param('id')
    const token = c.req.query('token') || null
    const plan = await getPlan(c.env.DB, planId)

    if (!plan) {
      return c.json({ error: '行程不存在' }, 404)
    }

    const editable = !!(token && plan.edit_token && plan.edit_token === token)

    return c.json({
      id: plan.id,
      title: plan.title,
      status: JSON.parse(plan.itinerary as string).status || 'completed',
      itinerary: JSON.parse(plan.itinerary as string),
      params: plan.params,
      city: plan.city,
      avg_rating: plan.avg_rating,
      rating_count: plan.rating_count,
      is_public: plan.is_public,
      version: plan.version,
      created_at: plan.created_at,
      editable,
    })
  } catch (error) {
    console.error('获取行程失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.put('/api/plans/:id', async (c) => {
  try {
    const planId = c.req.param('id')
    const updateData = await c.req.json()
    const { itinerary, version, is_public, title } = updateData

    const currentPlan = await getPlan(c.env.DB, planId)
    if (!currentPlan) return c.json({ error: '行程不存在' }, 404)
    const clientToken = c.req.header('X-Edit-Token')
    if (!clientToken || !currentPlan.edit_token || currentPlan.edit_token !== clientToken) {
      return c.json({ error: '无编辑权限，请使用正确的管理链接' }, 403)
    }

    if (typeof is_public === 'boolean' && !itinerary) {
      const updatePayload: any = {
        itinerary: currentPlan.itinerary,
        version: Date.now(),
        is_public: is_public ? 1 : 0,
      }
      await updatePlanWithOptimisticLock(c.env.DB, planId, updatePayload, currentPlan.version as number)
      return c.json({ success: true, is_public, version: Date.now() })
    }

    if (!itinerary || typeof version !== 'number') {
      return c.json({ error: '无效的参数' }, 400)
    }

    const updatePayload: any = {
      itinerary: JSON.stringify(itinerary),
      version: Date.now(),
      status: itinerary?.status || 'completed',
    }

    if (typeof is_public === 'boolean') {
      updatePayload.is_public = is_public ? 1 : 0
    }

    if (title && /^\[.+]/.test(title)) {
      updatePayload.title = title
    }

    const result = await updatePlanWithOptimisticLock(c.env.DB, planId, updatePayload, version)

    if (result.meta.changes === 0) {
      return c.json({ error: '行程已被其他用户修改，请刷新后重试' }, 409)
    }

    return c.json({ success: true, version: Date.now() })
  } catch (error) {
    console.error('修改行程失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.delete('/api/plans/:id', async (c) => {
  try {
    const planId = c.req.param('id')
    const plan = await getPlan(c.env.DB, planId)
    if (!plan) return c.json({ error: '行程不存在' }, 404)
    const clientToken = c.req.header('X-Edit-Token')
    if (!clientToken || !plan.edit_token || plan.edit_token !== clientToken) {
      return c.json({ error: '无删除权限，请使用正确的管理链接' }, 403)
    }
    await deletePlan(c.env.DB, planId)
    return c.json({ success: true })
  } catch (error) {
    console.error('删除行程失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

export default router

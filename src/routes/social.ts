import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import { getPlan, getFeaturedPlans } from '../services/db'
import { ShortlinkService } from '../services/shortlink'
import { FeaturedService } from '../services/featured'

const router = new Hono<{ Bindings: CloudflareBindings }>()

router.post('/api/plans/:id/shortlink', async (c) => {
  try {
    const planId = c.req.param('id')
    const plan = await getPlan(c.env.DB, planId)
    if (!plan) return c.json({ error: '方案不存在' }, 404)

    const shortlinkService = new ShortlinkService(c.env.CACHE)
    const shortId = await shortlinkService.generateShortlink(planId)
    return c.json({ short_id: shortId, short_url: `/s/${shortId}` })
  } catch (error) {
    console.error('生成短链接失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.get('/s/:short_id', async (c) => {
  try {
    const shortId = c.req.param('short_id')
    const shortlinkService = new ShortlinkService(c.env.CACHE)
    const planId = await shortlinkService.resolveShortlink(shortId)

    if (!planId) return c.redirect('/')
    return c.redirect(`/plan/${planId}`)
  } catch (error) {
    console.error('解析短链接失败:', error)
    return c.redirect('/')
  }
})

router.get('/api/featured', async (c) => {
  try {
    const featuredService = new FeaturedService(c.env.CACHE)
    const plans = await featuredService.getFeaturedPlans()

    if (plans.length === 0) {
      const dbPlans = await getFeaturedPlans(c.env.DB, 20)
      return c.json({ plans: dbPlans.results || [] })
    }

    return c.json({ plans: plans })
  } catch (error) {
    console.error('获取精选方案失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.post('/api/featured/update', async (c) => {
  try {
    const featuredService = new FeaturedService(c.env.CACHE)
    const plans = await featuredService.updateFeaturedPlans(c.env.DB)
    return c.json({ success: true, plans: plans })
  } catch (error) {
    console.error('更新精选方案失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

export default router

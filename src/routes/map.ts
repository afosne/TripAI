import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import { AmapService } from '../services/map'

const router = new Hono<{ Bindings: CloudflareBindings }>()

// 前端地图配置
router.get('/api/map/config', async (c) => {
  return c.json({ key: c.env.AMAP_JS_KEY || '', jscode: c.env.AMAP_JSCODE || '' })
})

// 反向地理编码
router.get('/api/geocode/reverse', async (c) => {
  try {
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    if (!lat || !lng) return c.json({ error: '缺少坐标参数' }, 400)

    const cacheKey = `rgeo:${lat},${lng}`
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) return c.json(JSON.parse(cached))

    const amap = new AmapService(c.env.AMAP_API_KEY)
    const result = await amap.regeocode(parseFloat(lng), parseFloat(lat))
    if (result) {
      const data = { formatted_address: result.formatted_address || '', city: result.city || '', province: result.province || '', district: result.district || '' }
      await c.env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 90 * 24 * 60 * 60 })
      return c.json(data)
    }
    return c.json({ formatted_address: '', city: '', province: '', district: '' })
  } catch (error) {
    console.error('反向地理编码失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

// 高德输入提示（自动补全，支持按当前位置就近排序）
router.get('/api/geocode/suggest', async (c) => {
  try {
    const keywords = c.req.query('keywords')
    if (!keywords) return c.json({ tips: [] })
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    const location = (lat && lng) ? `${lng},${lat}` : undefined
    const amap = new AmapService(c.env.AMAP_API_KEY)
    const tips = await amap.inputtips(keywords, location)
    return c.json({ tips })
  } catch (error) {
    console.error('输入提示失败:', error)
    return c.json({ tips: [] })
  }
})

export default router

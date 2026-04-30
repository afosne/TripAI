import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import { initDatabase } from '../services/db'

const router = new Hono<{ Bindings: CloudflareBindings }>()

router.get('/', (c) => {
  return c.text('TripAI Server is running!')
})

router.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

router.get('/api/bing-wallpaper', async (c) => {
  try {
    const res = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN')
    if (!res.ok) return c.json({ url: '' }, 500)
    const data = await res.json() as any
    const image = data?.images?.[0]
    if (!image) return c.json({ url: '' })

    return c.json({
      url: `https://www.bing.com${image.url}`,
      title: image.title || '',
      copyright: image.copyright || '',
    })
  } catch (error) {
    console.error('获取 Bing 壁纸失败:', error)
    return c.json({ url: '' }, 500)
  }
})

router.get('/api/init', async (c) => {
  try {
    await initDatabase(c.env.DB)
    const check = await c.env.DB.prepare('SELECT name FROM sqlite_master WHERE type="table"').all()
    return c.json({ success: true, tables: check.results?.map((r: any) => r.name) || [] })
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

router.get('/api/debug/plans', async (c) => {
  try {
    const all = await c.env.DB.prepare('SELECT id, title, city, is_public, version, avg_rating, created_at FROM plans ORDER BY created_at DESC LIMIT 20').all()
    const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM plans').first()
    const publicPlans = await c.env.DB.prepare('SELECT id, title, city, is_public FROM plans WHERE is_public = 1 LIMIT 20').all()
    return c.json({ total: count, allPlans: all.results, publicPlans: publicPlans.results })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

router.get('/api/debug/public', async (c) => {
  try {
    const { getPublicPlans } = await import('../services/db')
    const result = await getPublicPlans(c.env.DB, { sort: 'rating' }, 6, 0)
    return c.json({ raw: result, results: result.results, count: result.results?.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

export default router

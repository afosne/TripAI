import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'

import { resolveAIClient, logAI } from '../services/ai-stream'
import { buildImageKeywords, imageCacheGet, imageCachePut, downloadImageAsDataUrl, searchImage } from '../services/image'
import {AmapService} from "../services/map"
import { buildAttractionDetailPrompt } from '../prompt/attraction'

const router = new Hono<{ Bindings: CloudflareBindings }>()

router.get('/api/attraction/detail', async (c) => {
  try {
    const { name, city } = c.req.query()
    if (!name) return c.json({ error: '缺少景点名称' }, 400)

    const cacheKey = `attraction_guide:${city || ''}:${name}`
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) {
      return c.json({ cached: true, data: JSON.parse(cached) })
    }

    const { client: aiClient, provider } = resolveAIClient(c.env)
    const t0 = Date.now()
    logAI(provider, 'detail.start', { name, city })
    const result = await aiClient.chatJSON<any>({
      messages: [buildAttractionDetailPrompt(name, city)],
      response_format: { type: 'json_object' },
    })

    await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 90 * 24 * 60 * 60 })
    logAI(provider, 'detail.ok', { name, city, ms: Date.now() - t0 })
    return c.json({ cached: false, data: result })
  } catch (error) {
    console.error('获取景点详情失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.get('/api/attraction/geocode', async (c) => {
  try {
    const { name, city } = c.req.query()
    if (!name) return c.json({ error: '缺少景点名称' }, 400)

    const cacheKey = `geocode:${city || ''}:${name}`
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) return c.json({ cached: true, data: JSON.parse(cached) })

    const amapService = new AmapService(c.env.AMAP_API_KEY)
    const poi = await amapService.getPoiByName(name, city)
    if (!poi) {
      const geo = await amapService.geocode(name, city)
      if (!geo) return c.json({ error: '未找到该景点' }, 404)
      await c.env.CACHE.put(cacheKey, JSON.stringify(geo), { expirationTtl: 90 * 24 * 60 * 60 })
      return c.json({ cached: false, data: geo })
    }

    await c.env.CACHE.put(cacheKey, JSON.stringify(poi), { expirationTtl: 90 * 24 * 60 * 60 })
    return c.json({ cached: false, data: poi })
  } catch (error) {
    console.error('景点定位失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

router.get('/api/attraction/image', async (c) => {
  try {
    const { name } = c.req.query()
    if (!name) return c.json({ error: '缺少景点名称' }, 400)

    const keywords = buildImageKeywords(name)
    if (keywords.length === 0) return c.json({ cached: false, url: '' })

    // 并行从 Cache API 读取 base64
    const cacheApiResults = await Promise.all(keywords.map(kw => imageCacheGet(kw)))
    const cacheHitIdx = cacheApiResults.findIndex(Boolean)
    if (cacheHitIdx >= 0) return c.json({ cached: true, url: cacheApiResults[cacheHitIdx] })

    // 并行查 KV 链接缓存
    const kvResults = await Promise.all(keywords.map(kw => c.env.CACHE.get(`attraction_image:${kw}`)))
    const kvHitIdx = kvResults.findIndex(r => r && r.startsWith('http'))
    if (kvHitIdx >= 0) {
      const dataUrl = await downloadImageAsDataUrl(kvResults[kvHitIdx]!)
      if (dataUrl) {
        await imageCachePut(keywords[kvHitIdx], dataUrl)
        return c.json({ cached: true, url: dataUrl })
      }
      return c.json({ cached: true, url: kvResults[kvHitIdx] })
    }

    // 均未命中，搜索图片
    let imageUrl = ''
    let imageSource = ''
    for (const kw of keywords) {
      const result = await searchImage(kw, c.env.UNSPLASH_ACCESS_KEY)
      if (result.url) { imageUrl = result.url; imageSource = result.source; break }
    }

    if (imageUrl && imageSource === 'baidu') {
      const cacheKey = `attraction_image:${keywords[0]}`
      try { await c.env.CACHE.put(cacheKey, imageUrl, { expirationTtl: 90 * 24 * 60 * 60 }) } catch { /* KV 写入超限忽略 */ }
      const dataUrl = await downloadImageAsDataUrl(imageUrl)
      if (dataUrl) {
        await imageCachePut(keywords[0], dataUrl)
        return c.json({ cached: false, url: dataUrl })
      }
    }

    return c.json({ cached: false, url: imageUrl })
  } catch (error) {
    console.error('获取景点图片失败:', error)
    return c.json({ error: '内部服务器错误' }, 500)
  }
})

export default router

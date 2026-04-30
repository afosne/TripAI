export function buildImageKeywords(raw: string): string[] {
  const name = raw.trim()
  if (!name) return []

  const parts = name.split('·')

  if (parts.length >= 3 && /^(早|午|晚)餐$/.test(parts[0])) {
    const city = parts[1]
    const food = parts.slice(2).join('·')
    if (food.length < 2) return []
    return [city + food, food]
  }

  if (parts.length === 2 && /^(早|午|晚)餐$/.test(parts[0])) {
    const food = parts[1]
    return food.length >= 2 ? [food] : []
  }

  return [name]
}

export function pickLandscapeImage(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  const landscape = items.find((img: any) => img.width > img.height && img.hoverUrl?.startsWith('http'))
  const pick = landscape || items.find((img: any) => img.hoverUrl?.startsWith('http'))
  return pick ? pick.hoverUrl.replace(/[`\s]/g, '').trim() : ''
}

export async function downloadImageAsDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return `data:${contentType};base64,${btoa(binary)}`
  } catch { return null }
}

export async function imageCacheGet(keyword: string): Promise<string | null> {
  try {
    const cache = (caches as any).default
    const req = new Request(`https://cache.local/attraction_image/${encodeURIComponent(keyword)}`)
    const res = await cache.match(req)
    if (!res) return null
    return await res.text()
  } catch { return null }
}

export async function imageCachePut(keyword: string, dataUrl: string): Promise<void> {
  try {
    const cache = (caches as any).default
    const req = new Request(`https://cache.local/attraction_image/${encodeURIComponent(keyword)}`)
    const res = new Response(dataUrl, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=7776000' }
    })
    await cache.put(req, res)
  } catch { /* ignore */ }
}

export async function fetchWithRetry(url: string, retries = 1, timeoutMs = 5000): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return res
    } catch { /* retry */ }
  }
  return null
}

export async function searchImage(keyword: string, unsplashKey: string): Promise<{ url: string; source: string }> {
  const [r1, r2] = await Promise.allSettled([
    fetchWithRetry(`https://zj.v.api.aa1.cn/api/so-baidu-img/?msg=${encodeURIComponent(keyword)}&page=1`),
    fetchWithRetry(`https://api-v2.cenguigui.cn/api/baidu/?msg=${encodeURIComponent(keyword)}&page=1`),
  ])

  for (const r of [r1, r2]) {
    if (r.status === 'fulfilled' && r.value) {
      try {
        const url = pickLandscapeImage((await r.value.json() as any)?.data)
        if (url) return { url, source: 'baidu' }
      } catch { /* skip */ }
    }
  }

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${unsplashKey}` } }
    )
    if (res.ok) {
      const data = await res.json() as any
      const url = data?.results?.[0]?.urls?.regular || ''
      if (url) return { url, source: 'unsplash' }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${unsplashKey}` } }
    )
    if (res.ok) {
      const data = await res.json() as any
      return { url: data?.urls?.regular || '', source: 'unsplash' }
    }
  } catch { /* ignore */ }

  return { url: '', source: '' }
}

import { AmapService } from './map'
import type { CloudflareBindings } from '../types'
import { fmtDate } from '../utils/date'

const WEATHER_CACHE_TTL = 24 * 60 * 60 // 1天

export async function getWeatherWithForecasts(env: CloudflareBindings, city: string, startDate?: string, endDate?: string) {
  const todayKey = `weather:${city}:${fmtDate(new Date())}`
  let live: any = null
  const liveCached = await env.CACHE.get(todayKey)
  if (liveCached) live = JSON.parse(liveCached)

  const start = startDate ? new Date(startDate) : new Date()
  const end = endDate ? new Date(endDate) : (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d })()

  const dates: string[] = []
  const d = new Date(start)
  while (d <= end) {
    dates.push(fmtDate(d))
    d.setDate(d.getDate() + 1)
  }

  const cachedForecasts = await Promise.all(
    dates.map(ds => env.CACHE.get(`weather_forecast:${city}:${ds}`))
  )
  const forecasts = new Map<string, any>()
  dates.forEach((ds, i) => {
    if (cachedForecasts[i]) forecasts.set(ds, JSON.parse(cachedForecasts[i]))
  })

  const missing = dates.filter(ds => !forecasts.has(ds))
  if (missing.length === 0 && live) {
    return { live, forecasts: dates.map(ds => forecasts.get(ds)) }
  }

  // 优先 60s API，失败降级高德
  const fetched = await fetchFrom60s(city) || await fetchFromAmap(env, city)

  if (fetched) {
    if (fetched.live) {
      live = fetched.live
      await env.CACHE.put(todayKey, JSON.stringify(live), { expirationTtl: WEATHER_CACHE_TTL })
    }
    for (const f of fetched.forecasts) {
      forecasts.set(f.date, f)
      await env.CACHE.put(`weather_forecast:${city}:${f.date}`, JSON.stringify(f), { expirationTtl: WEATHER_CACHE_TTL })
    }
  }

  return { live, forecasts: dates.map(ds => forecasts.get(ds)).filter(Boolean) }
}

async function fetchFrom60s(city: string): Promise<{ live: any | null; forecasts: any[] } | null> {
  try {
    const url = `https://60s.viki.moe/v2/weather/forecast?query=${encodeURIComponent(city)}&days=7`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`60s API返回 ${resp.status}`)

    const result = await resp.json() as any
    const data = result.data
    if (!data) throw new Error('60s API返回数据为空')

    let live: any = null
    if (Array.isArray(data.hourly_forecast) && data.hourly_forecast.length > 0) {
      const h = data.hourly_forecast[0]
      live = {
        temperature: h.temperature,
        weather: h.condition,
        winddirection: h.wind_direction,
        windpower: h.wind_power,
      }
    }

    const forecasts: any[] = []
    if (Array.isArray(data.daily_forecast)) {
      for (const df of data.daily_forecast) {
        forecasts.push({
          date: df.date,
          dayweather: df.day_condition,
          nighttemp: df.min_temperature,
          daytemp: df.max_temperature,
        })
      }
    }

    console.log(`[weather] 60s API成功: live=${!!live}, forecasts=${forecasts.length}天`)
    return { live, forecasts }
  } catch (e) {
    console.warn('[weather] 60s天气失败，降级高德:', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function fetchFromAmap(env: CloudflareBindings, city: string): Promise<{ live: any | null; forecasts: any[] } | null> {
  try {
    const amap = new AmapService(env.AMAP_API_KEY)
    const geo = await amap.geocode(city)
    const cityParam = geo?.adcode || city
    const result = await amap.getWeatherWithForecasts(cityParam)

    const live = result.live || null
    const forecasts = result.forecasts || []
    console.log(`[weather] 高德降级成功: live=${!!live}, forecasts=${forecasts.length}天`)
    return { live, forecasts }
  } catch (e) {
    console.warn('[weather] 高德天气也失败:', e instanceof Error ? e.message : String(e))
    return null
  }
}

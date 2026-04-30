import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import { resolveAIClient, logAI, streamAIStep } from '../services/ai-stream'
import { getWeatherWithForecasts } from '../services/weather-client'
import { getPaceConfig } from '../prompt/config'
import { OpenAIError } from '../services/openai'
import { buildExplorePrompt, buildAttractionsPrompt, buildFoodPrompt, buildGeneratePrompt } from '../prompt/generate'

const router = new Hono<{ Bindings: CloudflareBindings }>()

async function enqueueStep(env: CloudflareBindings, messages: any[], maxTokens?: number, planId?: string, editToken?: string): Promise<string> {
  if (!env.AI_QUEUE) throw new Error('AI 队列未配置')
  const requestId = crypto.randomUUID()
  await env.AI_QUEUE.send({ messages, maxTokens, requestId, planId, editToken })
  logAI('queue', 'enqueue', { requestId, planId, msgCount: messages.length, maxTokens })
  return requestId
}

async function executeAI(c: any, messages: any[], maxTokens?: number, planId?: string, editToken?: string) {
  if (c.env.AI_MODE === 'queue') {
    const requestId = await enqueueStep(c.env, messages, maxTokens, planId, editToken)
    return c.json({ requestId })
  }
  const { client, provider } = resolveAIClient(c.env)
  return streamAIStep(c, client, provider, messages, maxTokens)
}

router.post('/api/plans/generate-step', async (c) => {
  const { step, params, context, planId, editToken } = await c.req.json()

  if (step === 'generate') {
    const ctxKeys = context ? Object.keys(context) : []
    const ctxSummary = ctxKeys.map(k => {
      const v = context[k]
      if (Array.isArray(v)) return `${k}=[${v.length}]`
      if (v && typeof v === 'object') return `${k}={${Object.keys(v).join(',')}}`
      return `${k}=${typeof v}`
    }).join(', ')
    console.log(`[generate-step] generate请求: destination=${params?.destination}, days=${params?.days}, context={${ctxSummary}}, mode=${c.env.AI_MODE || 'stream'}`)
  } else {
    console.log(`[generate-step] 开始步骤: ${step}, 目的地: ${params?.destination}`)
  }

  try {
    switch (step) {
      case 'weather': {
        const city = params.destination
        try {
          console.log(`[weather] 查询 ${city} 天气`)
          const { live, forecasts } = await getWeatherWithForecasts(c.env, city, params.start_date, params.end_date)
          if (live) {
            console.log(`[weather] 成功: ${live.weather} ${live.temperature}°C, 预报 ${forecasts.length} 天`)
          }
          return c.json({ live, forecasts })
        } catch (e) {
          console.warn('[weather] 天气查询失败:', e instanceof Error ? e.message : String(e))
          return c.json({ live: null, forecasts: [] })
        }
      }

      case 'explore': {
        const pace = getPaceConfig(params)
        return executeAI(c, [buildExplorePrompt(params, pace)])
      }

      case 'attractions': {
        const pace = getPaceConfig(params)
        let effectiveDays = params.days
        if (params.arrival_time) effectiveDays -= 0.5
        if (params.departure_time) effectiveDays -= 0.5
        const mustCount = Math.max(1, Math.ceil(effectiveDays * (pace.mustHours >= 8 ? 2 : 1.5)))
        const mustHours = pace.mustHours
        return executeAI(c, [buildAttractionsPrompt(params, pace, mustCount, mustHours)], 4096)
      }

      case 'food': {
        return executeAI(c, [buildFoodPrompt(params)])
      }

      case 'generate': {
        const weatherInfo = context?.weather
        const exploreInfo = context?.explore
        const attractions = Array.isArray(context?.attractions) ? context.attractions : []
        const foods = Array.isArray(context?.food) ? context.food : []
        const pace = getPaceConfig(params)

        console.log(`[generate] context诊断: weather=${!!weatherInfo}, explore=${!!exploreInfo && !!exploreInfo?.overview}, attractions=${attractions.length}, foods=${foods.length}, destination=${params?.destination}, days=${params?.days}, pace=${params?.pace || 'moderate'}`)

        if (!params?.destination || !params?.days) {
          console.error(`[generate] 缺少必要参数: destination=${params?.destination}, days=${params?.days}`)
          return c.json({ error: { message: `缺少必要参数: destination=${params?.destination}, days=${params?.days}`, code: 'MISSING_PARAMS' } }, 400)
        }
        if (attractions.length === 0 && foods.length === 0) {
          console.warn(`[generate] 景点和美食数据均为空，AI将基于通用知识生成行程`)
        }

        const attractionList = attractions.length > 0 ? attractions.map((a: any, i: number) => {
          const tag = a.level === 'must' ? '【必去】' : '【可选】'
          return `${i + 1}. ${tag} ${a.name}（约${a.estimated_duration}分钟）: ${a.description}`
        }).join('\n') : '（暂无景点数据，请根据目的地推荐必去景点和打卡点）'
        const foodList = foods.length > 0 ? foods.map((f: any, i: number) => `${i + 1}. ${f.name}: ${f.description}`).join('\n') : '（暂无美食数据，请根据目的地推荐特色美食）'

        let weatherContext = ''
        if (weatherInfo?.live) {
          weatherContext = `当前天气：${weatherInfo.live.weather}，温度 ${weatherInfo.live.temperature}°C\n`
        }
        if (Array.isArray(weatherInfo?.forecasts) && weatherInfo.forecasts.length > 0) {
          const forecastStr = weatherInfo.forecasts.map((f: any) => `${f.date}: ${f.dayweather}，${f.nighttemp}°C~${f.daytemp}°C`).join('\n')
          weatherContext += `旅行期间天气预报：\n${forecastStr}\n`
        }

        const promptContent = buildGeneratePrompt(params, pace, weatherContext, exploreInfo, attractionList, foodList)
        return executeAI(c, [promptContent], 8192, planId, editToken)
      }

      default:
        return c.json({ error: '未知步骤' }, 400)
    }
  } catch (error) {
    if (error instanceof OpenAIError) {
      const statusCode: 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451 | 502 =
        error.status >= 400 && error.status < 500 ? (error.status as 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451) : 502
      return c.json({ error: { message: error.message, code: error.code } }, statusCode)
    }
    console.error(`[generate-step] 步骤 ${step} 失败:`, error)
    const msg = error instanceof Error ? error.message : String(error)
    return c.json({ error: { message: `${step}步骤失败: ${msg}`, code: 'STEP_ERROR' } }, 500)
  }
})

router.get('/api/plans/generate-step/result/:requestId', async (c) => {
  const { requestId } = c.req.param()
  const raw = await c.env.CACHE.get(`ai-result:${requestId}`)
  if (!raw) return c.json({ status: 'pending' })
  const data = JSON.parse(raw)
  if (data.error) return c.json({ status: 'error', error: data.error })
  return c.json({ status: 'done', content: data.content, saved: !!data.saved })
})

export default router

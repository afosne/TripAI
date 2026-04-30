import { streamSSE } from 'hono/streaming'
import { createOpenAIClient } from './openai'
import type { CloudflareBindings } from '../types'

export function resolveAIClient(env: CloudflareBindings) {
  if (env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL) {
    return {
      client: createOpenAIClient({
        apiKey: env.AI_API_KEY,
        baseURL: env.AI_BASE_URL,
        defaultModel: env.AI_MODEL,
        defaultTemperature: 0.7,
        defaultMaxTokens: 8192,
      }),
      provider: 'custom' as const,
    }
  }

  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID && env.AI_GATEWAY_TOKEN) {
    const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/compat`
    return {
      client: createOpenAIClient({
        apiKey: env.AI_GATEWAY_TOKEN,
        baseURL,
        defaultModel: env.AI_FALLBACK_MODEL || 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        defaultTemperature: 0.7,
        defaultMaxTokens: 8192,
      }),
      provider: 'workers-ai' as const,
    }
  }

  throw new Error('AI 服务未配置：请设置自定义模型（AI_API_KEY/AI_BASE_URL/AI_MODEL）或 Workers AI（AI_GATEWAY_ACCOUNT_ID/AI_GATEWAY_ID/AI_GATEWAY_TOKEN）')
}

export function logAI(tag: string, event: string, data: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ ts, tag, event, ...data }))
}

export async function streamAIStep(c: any, client: any, provider: string, messages: any[], maxTokens?: number) {
  return streamSSE(c, async (stream) => {
    const timeoutMs = provider === 'custom' ? 240_000 : undefined
    const t0 = Date.now()
    let contentSent = false
    let chunks = 0

    try {
      const reqBody: any = { messages, response_format: { type: 'json_object' } }
      if (maxTokens) reqBody.max_tokens = maxTokens
      const response = await client.chatStream(reqBody, timeoutMs)
      const reader = response.body?.getReader()
      if (!reader) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: 'AI 服务不可用' }) })
        logAI(provider, 'stream.empty', { reason: 'no_reader', ms: Date.now() - t0 })
        return
      }

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
          if (!trimmed.startsWith('data:') || trimmed.length <= 5) continue
          const data = trimmed[5] === ' ' ? trimmed.slice(6) : trimmed.slice(5)
          if (!data || data === '[DONE]') continue
          try {
            const content = JSON.parse(data).choices?.[0]?.delta?.content
            if (content) {
              await stream.writeSSE({ event: 'delta', data: content })
              contentSent = true
              chunks++
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      const ms = Date.now() - t0
      if (contentSent) {
        await stream.writeSSE({ event: 'done', data: '{}' })
        logAI(provider, 'stream.ok', { chunks, ms })
      } else {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: 'AI 服务暂时不可用，请稍后重试' }) })
        logAI(provider, 'stream.empty', { reason: 'no_content', ms })
      }
    } catch (e) {
      const ms = Date.now() - t0
      const msg = e instanceof Error ? e.message : String(e)
      logAI(provider, contentSent ? 'stream.partial' : 'stream.error', { chunks, ms, error: msg })
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: contentSent ? '流式传输中断，请重试' : 'AI 服务暂时不可用，请稍后重试' }) })
    }
  })
}

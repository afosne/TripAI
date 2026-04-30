function extractJSON(text: string): unknown | null {
  const s = text.trim()
  // Direct parse
  try { return JSON.parse(s) } catch {}
  // Strip markdown code fence: ```json ... ``` or ``` ... ```
  const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch {}
  }
  // Find first { ... } or [ ... ] block
  const first = s.search(/[{[]/)
  if (first !== -1) {
    const open = s[first]
    const close = open === '{' ? '}' : ']'
    let depth = 0, inStr = false, esc = false
    for (let i = first; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === open) depth++
      if (c === close) { depth--; if (depth === 0) {
        try { return JSON.parse(s.slice(first, i + 1)) } catch {}
        break
      }}
    }
  }
  return null
}

interface OpenAIConfig {
  apiKey: string
  baseURL: string
  defaultModel?: string
  defaultMaxTokens?: number
  defaultTemperature?: number
  extraHeaders?: Record<string, string>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

export interface ChatCompletionRequest {
  model?: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  top_p?: number
  stream?: boolean
  stop?: string | string[]
  presence_penalty?: number
  frequency_penalty?: number
  response_format?: { type: 'text' | 'json_object' }
  tools?: ChatCompletionTool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
  n?: number
}

interface ChatCompletionTool {
  type: 'function' | 'web_search'
  function?: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface ChatCompletionChoice {
  index: number
  message: {
    role: string
    content: string | null
    tool_calls?: Array<{
      id: string
      type: string
      function: { name: string; arguments: string }
    }>
  }
  finish_reason: string
}

interface ChatCompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage: ChatCompletionUsage
}

export class OpenAIError extends Error {
  status: number
  code: string
  detail: unknown

  constructor(message: string, status: number, code: string, detail?: unknown) {
    super(message)
    this.name = 'OpenAIError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

import { JSON_INSTRUCTION, SYSTEM_MESSAGE } from '../prompt/system'

const SYSTEM_MESSAGE_ZH: ChatMessage = {
  role: 'system',
  content: SYSTEM_MESSAGE,
}

function injectSystemMessage(messages: ChatMessage[], appendJson = false): ChatMessage[] {
  if (messages.length > 0 && messages[0].role === 'system') {
    if (appendJson) {
      return [{ ...messages[0], content: messages[0].content + '\n' + JSON_INSTRUCTION }, ...messages.slice(1)]
    }
    return messages
  }
  const sys = appendJson
    ? { ...SYSTEM_MESSAGE_ZH, content: SYSTEM_MESSAGE_ZH.content + '\n' + JSON_INSTRUCTION }
    : SYSTEM_MESSAGE_ZH
  return [sys, ...messages]
}

export class OpenAIClient {
  private config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
  }

  async chatStream(request: ChatCompletionRequest, timeoutMs?: number): Promise<Response> {
    const url = `${this.config.baseURL}/chat/completions`

    const body: Record<string, unknown> = {
      model: request.model || this.config.defaultModel || 'gpt-3.5-turbo',
      messages: injectSystemMessage(request.messages),
      temperature: request.temperature ?? this.config.defaultTemperature ?? 0.7,
      stream: true,
    }

    if (request.max_tokens !== undefined || this.config.defaultMaxTokens !== undefined) {
      body.max_tokens = request.max_tokens ?? this.config.defaultMaxTokens
    }
    if (request.response_format !== undefined) body.response_format = request.response_format

    if (!this.config.apiKey) {
      throw new OpenAIError('AI_API_KEY 未配置', 401, 'MISSING_API_KEY')
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      }
    if (this.config.extraHeaders) Object.assign(headers, this.config.extraHeaders)

    const controller = new AbortController()
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      if (timer) clearTimeout(timer)
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new OpenAIError(`AI 流式请求超时 (${timeoutMs}ms)`, 504, 'TIMEOUT')
      }
      throw e
    }
    if (timer) clearTimeout(timer)

    if (!response.ok) {
      let errorBody: unknown = ''
      try { errorBody = await response.json() } catch { try { errorBody = await response.text() } catch { errorBody = '' } }
      const errMsg = (errorBody as any)?.error?.message || (errorBody as any)?.message || response.statusText
      const errCode = (errorBody as any)?.error?.code || (errorBody as any)?.code || `HTTP_${response.status}`
      throw new OpenAIError(errMsg, response.status, errCode, errorBody)
    }

    return response
  }

  async chatCompletion(request: ChatCompletionRequest, appendJson = false, timeoutMs?: number): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseURL}/chat/completions`

    const body: Record<string, unknown> = {
      model: request.model || this.config.defaultModel || 'gpt-3.5-turbo',
      messages: injectSystemMessage(request.messages, appendJson),
      temperature: request.temperature ?? this.config.defaultTemperature ?? 0.7,
    }

    if (request.max_tokens !== undefined || this.config.defaultMaxTokens !== undefined) {
      body.max_tokens = request.max_tokens ?? this.config.defaultMaxTokens
    }
    if (request.top_p !== undefined) body.top_p = request.top_p
    if (request.stream !== undefined) body.stream = request.stream
    if (request.stop !== undefined) body.stop = request.stop
    if (request.presence_penalty !== undefined) body.presence_penalty = request.presence_penalty
    if (request.frequency_penalty !== undefined) body.frequency_penalty = request.frequency_penalty
    if (request.response_format !== undefined) body.response_format = request.response_format
    if (request.tools !== undefined) body.tools = request.tools
    if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice
    if (request.n !== undefined) body.n = request.n

    if (!this.config.apiKey) {
      throw new OpenAIError('AI_API_KEY 未配置', 401, 'MISSING_API_KEY')
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (this.config.extraHeaders) Object.assign(headers, this.config.extraHeaders)

    const controller = new AbortController()
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      if (timer) clearTimeout(timer)
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new OpenAIError(`AI 请求超时 (${timeoutMs}ms)`, 504, 'TIMEOUT')
      }
      throw e
    }
    if (timer) clearTimeout(timer)

    if (!response.ok) {
      let errorBody: unknown = ''
      try {
        errorBody = await response.json()
      } catch {
        try {
          errorBody = await response.text()
        } catch {
          errorBody = ''
        }
      }
      const errMsg =
        (errorBody as any)?.error?.message ||
        (errorBody as any)?.message ||
        (typeof errorBody === 'string' ? errorBody : '') ||
        response.statusText
      const errCode =
        (errorBody as any)?.error?.code ||
        (errorBody as any)?.code ||
        `HTTP_${response.status}`
      throw new OpenAIError(errMsg, response.status, errCode, errorBody)
    }

    return (await response.json()) as ChatCompletionResponse
  }

  async chat(request: ChatCompletionRequest, appendJson = false): Promise<string> {
    const data = await this.chatCompletion(request, appendJson)
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new OpenAIError('AI 返回空内容', 502, 'EMPTY_RESPONSE', data)
    }
    return content
  }

  async chatJSON<T = unknown>(request: ChatCompletionRequest): Promise<T> {
    // 先尝试带 response_format
    try {
      const content = await this.chat({
        ...request,
        response_format: request.response_format || { type: 'json_object' },
      })
      const json = extractJSON(content)
      if (json !== null) return json as T
    } catch (e: any) {
      // 非不支持的 response_format 错误，直接抛出
      const msg = String(e?.message || e || '')
      if (!/response_format|response.format|not support|unsupported|unknown.*field|invalid.*field/i.test(msg)) {
        throw e
      }
    }
    // 降级：不带 response_format，在系统提示词中要求 JSON
    const content = await this.chat({
      ...request,
      response_format: undefined,
    }, true)
    const json = extractJSON(content)
    if (json === null) {
      throw new OpenAIError('AI 返回内容无法解析为 JSON', 502, 'INVALID_JSON', content)
    }
    return json as T
  }
}

export function createOpenAIClient(config: OpenAIConfig): OpenAIClient {
  return new OpenAIClient(config)
}

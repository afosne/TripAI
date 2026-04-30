import { useState, useEffect, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { getDateDisplay } from '../utils/holidays'
import { isCoord, resolveLocation } from '../utils/location'
import { groupByTimePeriod, getDayDate } from '../utils/plan'

function toLocation(val) {
  const text = (typeof val === 'string' ? val : '').trim()
  if (!text || isCoord(text)) return ''
  return text
}

const STEPS = [
  { key: 'weather', icon: '🌤️', title: '获取天气信息', waiting: '正在查询实时天气...' },
  { key: 'explore', icon: '🌍', title: '分析目的地特色', waiting: '正在了解城市概况...' },
  { key: 'attractions', icon: '📍', title: '搜索推荐景点', waiting: '正在筛选最佳景点...' },
  { key: 'food', icon: '🍜', title: '挖掘当地美食', waiting: '正在寻找特色美食...' },
  { key: 'generate', icon: '🗺️', title: '生成完整行程', waiting: '正在编排最终行程...(大致需要五到十分钟,请耐心等待谢谢)' },
]

function Plan() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const params = location.state?.params
  const editToken = location.state?.edit_token

  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resolvedCity, setResolvedCity] = useState('')
  const [resolvedLocations, setResolvedLocations] = useState({})

  const resolvedParams = params || (() => { try { const p = typeof plan?.params === 'string' ? JSON.parse(plan.params) : plan?.params; return p } catch { return null } })()
  const startDate = resolvedParams?.start_date || plan?.start_date

  const [error, setError] = useState(null)
  const [generatingDone, setGeneratingDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showTransition, setShowTransition] = useState(false)

  const GEN_STORAGE_KEY = `aitu_gen_${id}`

  const restoreGenState = () => {
    try {
      const raw = sessionStorage.getItem(GEN_STORAGE_KEY)
      if (!raw) return null
      return JSON.parse(raw)
    } catch { return null }
  }

  const persisted = restoreGenState()
  const [stepResults, setStepResults] = useState(persisted?.stepResults || {})
  const [currentStep, setCurrentStep] = useState(persisted?.currentStep ?? -1)
  const [stepErrors, setStepErrors] = useState(persisted?.stepErrors || {})

  const persistGenState = (updates) => {
    try {
      const prev = restoreGenState() || {}
      const next = { ...prev, ...updates }
      sessionStorage.setItem(GEN_STORAGE_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
  }

  const clearGenState = () => {
    try { sessionStorage.removeItem(GEN_STORAGE_KEY) } catch { /* ignore */ }
  }

  const isGenerating = useRef(false)
  const bottomRef = useRef(null)

  // Close transition animation as soon as any parallel step receives data
  useEffect(() => {
    if (!showTransition) return
    if (stepResults.explore || stepResults.attractions || stepResults.food) {
      setShowTransition(false)
    }
  }, [stepResults.explore, stepResults.attractions, stepResults.food, showTransition])

  // Persist generation state to sessionStorage on changes
  useEffect(() => {
    if (currentStep >= 0) {
      persistGenState({ stepResults, currentStep, stepErrors })
    }
  }, [stepResults, currentStep, stepErrors])

  useEffect(() => {
    if (bottomRef.current && currentStep >= 0) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [stepResults, currentStep])

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const response = await fetch(`/api/plans/${id}`)
        if (!response.ok) throw new Error('获取行程失败')
        const data = await response.json()
        setPlan(data)
        return data
      } catch (err) {
        setError(err.message)
        return null
      } finally {
        setLoading(false)
      }
    }

    const init = async () => {
      const data = await fetchPlan()
      // 优先用 location.state 传过来的 params，否则从 plan 数据中解析
      const planParams = params || (() => {
        try {
          const p = typeof data?.params === 'string' ? JSON.parse(data.params) : data?.params
          return p
        } catch { return null }
      })()
      if (data && data.status === 'pending' && planParams && !isGenerating.current) {
        isGenerating.current = true
        runSteps(planParams)
      } else if (data && data.status !== 'pending') {
        clearGenState()
      }
    }

    init()
  }, [id])

  // 解析坐标形式的城市名和活动地点
  useEffect(() => {
    if (!plan) return
    const rawCity = (() => { try { return JSON.parse(plan.params).destination || plan.city } catch { return plan.city } })()
    if (isCoord(rawCity)) {
      resolveLocation(rawCity).then(name => setResolvedCity(name))
    } else {
      setResolvedCity(rawCity || '')
    }
    const days = plan.itinerary?.days || []
    const tasks = []
    const map = {}
    days.forEach(d => (d.activities || []).forEach((act) => {
      const loc = (typeof act.location === 'string' ? act.location : '').trim()
      if (isCoord(loc) && act.name) {
        tasks.push(resolveLocation(loc).then(name => { map[act.name] = name }))
      }
    }))
    if (tasks.length) Promise.all(tasks).then(() => setResolvedLocations(map))
  }, [plan])

  const AI_STEPS = ['explore', 'attractions', 'food', 'generate']

  const pollAIResult = async (requestId) => {
    const maxWait = 600_000
    const interval = 2000
    const t0 = Date.now()
    while (Date.now() - t0 < maxWait) {
      await new Promise(r => setTimeout(r, interval))
      const resp = await fetch(`/api/plans/generate-step/result/${requestId}`)
      if (!resp.ok) continue
      const data = await resp.json()
      if (data.status === 'pending') continue
      if (data.status === 'error') throw new Error(data.error)
      return data
    }
    throw new Error('AI 处理超时，请重试')
  }

  // Multi-strategy JSON parser with progressive fallback
  function parseStreamJSON(text, stepKey) {
    if (!text || !text.trim()) return {}
    const trimmed = text.trim()

    // Strategy 1: Direct parse
    try { const r = JSON.parse(trimmed); if (r && typeof r === 'object') return r } catch {}

    // Strategy 2: Strip markdown code fences ```json ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) try { const r = JSON.parse(fenceMatch[1].trim()); if (r && typeof r === 'object') return r } catch {}

    // Strategy 3: Greedy match outermost { ... }
    const greedyMatch = trimmed.match(/\{[\s\S]*\}/)
    if (greedyMatch) try { const r = JSON.parse(greedyMatch[0]); if (r && typeof r === 'object') return r } catch {}

    // Strategy 4: For items-based steps, try to reconstruct {"items":[...]}
    if (stepKey === 'attractions' || stepKey === 'food') {
      const itemsMatch = trimmed.match(/"items"\s*:\s*\[/)
      if (itemsMatch) {
        const start = trimmed.indexOf(itemsMatch[0])
        const arrContent = trimmed.slice(start + itemsMatch[0].length)
        const extracted = []
        let depth = 0, objStart = -1, inStr = false, esc = false
        for (let i = 0; i < arrContent.length; i++) {
          const c = arrContent[i]
          if (esc) { esc = false; continue }
          if (c === '\\') { esc = true; continue }
          if (c === '"') { inStr = !inStr; continue }
          if (inStr) continue
          if (c === '{') { if (depth === 0) objStart = i; depth++ }
          else if (c === '}') { depth--; if (depth === 0 && objStart >= 0) { try { extracted.push(JSON.parse(arrContent.slice(objStart, i + 1))) } catch {} objStart = -1 } }
        }
        if (extracted.length > 0) return { items: extracted }
      }
    }

    // Strategy 5: For generate/explore, try to close trailing brackets
    let patched = trimmed
    let openBrackets = 0, openBraces = 0, inS = false, es = false
    for (let i = 0; i < patched.length; i++) {
      const c = patched[i]; if (es) { es = false; continue }; if (c === '\\') { es = true; continue }
      if (c === '"') { inS = !inS; continue }; if (inS) continue
      if (c === '[') openBrackets++; else if (c === ']') openBrackets--
      else if (c === '{') openBraces++; else if (c === '}') openBraces--
    }
    // If inside a string, close it
    if (inS) patched += '"'
    // Recount after potential fix
    openBrackets = 0; openBraces = 0; inS = false; es = false
    for (let i = 0; i < patched.length; i++) {
      const c = patched[i]; if (es) { es = false; continue }; if (c === '\\') { es = true; continue }
      if (c === '"') { inS = !inS; continue }; if (inS) continue
      if (c === '[') openBrackets++; else if (c === ']') openBrackets--
      else if (c === '{') openBraces++; else if (c === '}') openBraces--
    }
    patched += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces))
    try { const r = JSON.parse(patched); if (r && typeof r === 'object') return r } catch {}

    console.warn(`[parseStreamJSON] 所有策略失败 for step=${stepKey}, text length=${text.length}`)
    return {}
  }

  const runSteps = async (planParams) => {
    const context = {}
    const stepUrl = '/api/plans/generate-step'
    const MAX_RETRIES = 3

    const readSSE = async (response, step) => {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let fullText = ''
      let doneReceived = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim()
            if (!dataStr) continue

            if (currentEvent === 'delta') {
              fullText += dataStr
            } else if (currentEvent === 'done') {
              doneReceived = true
              const json = parseStreamJSON(fullText, step.key)
              if (step.key === 'attractions' || step.key === 'food') {
                return json.items || []
              } else if (step.key === 'generate') {
                return (json.days || json.title) ? json : {}
              }
              return (json && Object.keys(json).length > 0) ? json : {}
            } else if (currentEvent === 'error') {
              let msg = dataStr
              try { msg = JSON.parse(dataStr).message || dataStr } catch { /* keep raw */ }
              throw new Error(msg)
            }
          }
        }
      }

      if (!doneReceived) {
        throw new Error('流式响应异常结束')
      }
    }

    // Execute a single step with retries
    const executeStep = async (step, stepIndex) => {

      if (step.key === 'generate') {
        const ctxSummary = {
          weather: !!(context.weather && (context.weather.live || context.weather.forecasts)),
          explore: !!(context.explore && Object.keys(context.explore).length > 0),
          attractions: Array.isArray(context.attractions) ? context.attractions.length : 'not_array',
          food: Array.isArray(context.food) ? context.food.length : 'not_array',
        }
        console.log(`[runSteps] 即将执行generate, context:`, ctxSummary, 'params:', { destination: planParams.destination, days: planParams.days })
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const isStreamStep = AI_STEPS.includes(step.key)
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 900000)

          const response = await fetch(stepUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: step.key,
              params: planParams,
              context: context,
              planId: id,
              editToken: editToken,
            }),
            signal: controller.signal,
          })
          clearTimeout(timeout)

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}))
            throw new Error(errData.error?.message || `${step.title}失败`)
          }

          if (isStreamStep) {
            const contentType = response.headers.get('content-type') || ''
            let result
            if (contentType.includes('application/json')) {
              // 队列模式：POST 返回 requestId，轮询拿结果
              const { requestId } = await response.json()
              const aiResult = await pollAIResult(requestId)
              const json = parseStreamJSON(aiResult.content, step.key)
              if (step.key === 'attractions' || step.key === 'food') {
                result = json.items || []
              } else if (step.key === 'generate') {
                result = (json.days || json.title) ? json : {}
                if (aiResult.saved) result._saved = true
              } else {
                result = (json && Object.keys(json).length > 0) ? json : {}
              }
            } else {
              // 流式模式：读取 SSE
              result = await readSSE(response, step)
            }
            console.log(`[executeStep] ${step.key}: 完成, data=${Array.isArray(result) ? `array[${result.length}]` : Object.keys(result).join(',')}`)
            context[step.key] = result
            setStepResults(prev => ({ ...prev, [step.key]: result }))
          } else {
            const result = await response.json()
            const data = result.data || result
            context[step.key] = data
            setStepResults(prev => ({ ...prev, [step.key]: data }))
          }
          if (step.key === 'generate') {
            const gen = context.generate
            const genDays = gen?.days
            const hasActs = Array.isArray(genDays) && genDays.length > 0 && genDays.some(d => d.activities?.length > 0)
            if (!hasActs) {
              console.warn(`[runSteps] generate 第${attempt}次返回空数据, days=${Array.isArray(genDays) ? genDays.length : 'none'}, 重试`)
              delete context.generate
              throw new Error('AI 返回了空行程数据')
            }
          }
          return // success
        } catch (err) {
          const isAbort = err.name === 'AbortError'
          console.warn(`步骤 ${step.key} 第${attempt}次失败${isAbort ? '（超时）' : ''}:`, err.message)
          if (attempt < MAX_RETRIES) {
            setStepResults(prev => ({ ...prev, [step.key]: null }))
            await new Promise(r => setTimeout(r, 1500 * attempt))
          } else {
            console.error(`步骤 ${step.key} 重试${MAX_RETRIES}次后仍然失败`)
            setStepErrors(prev => ({ ...prev, [step.key]: err.message }))
            try {
              await fetch(`/api/plans/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
                body: JSON.stringify({
                  itinerary: { status: 'failed', error: `${step.title}失败（已重试${MAX_RETRIES}次）：${err.message}` },
                  version: 1,
                }),
              })
            } catch { /* ignore */ }
            setError(`行程生成失败：${step.title}失败（已重试${MAX_RETRIES}次）`)
            clearGenState()
            throw err
          }
        }
      }
    }

    // Step 1: weather (sequential)
    setCurrentStep(0)
    await executeStep(STEPS[0], 0)

    // Transition animation between weather and explore
    setShowTransition(true)

    // Step 2: explore, attractions, food in parallel
    const parallelSteps = STEPS.slice(1, 4)
    const parallelResults = await Promise.allSettled(
      parallelSteps.map((step, idx) => executeStep(step, idx + 1))
    )
    if (parallelResults.some(r => r.status === 'rejected')) return

    // 检查 explore 结果是否包含拒绝提示（非地球/非旅行目的地）
    if (context.explore?.overview?.includes('不在本服务支持范围') || context.explore?.overview?.includes('仅支持地球')) {
      setError(`无法生成行程：${context.explore.overview}`)
      try {
        await fetch(`/api/plans/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
          body: JSON.stringify({
            itinerary: { status: 'failed', error: context.explore.overview },
            version: 1,
          }),
        })
      } catch { /* ignore */ }
      clearGenState()
      return
    }

    // Step 3: generate (after all parallel steps complete)
    setCurrentStep(4)
    await executeStep(STEPS[4], 4)

    const itinerary = context.generate
    // Validate generate result with detailed diagnostics
    if (!itinerary || typeof itinerary !== 'object') {
      console.error('[runSteps] generate结果无效:', itinerary)
      setError('行程生成失败：AI 未返回有效数据，请重新创建')
      return
    }
    const days = itinerary.days
    const hasActivities = Array.isArray(days) && days.length > 0 && days.some(d => d.activities?.length > 0)
    if (!hasActivities) {
      // 检查是否是 AI 主动拒绝（非地球/非旅行目的地）
      const rejectTitle = itinerary.title || ''
      const isRejected = rejectTitle.includes('不支持') || rejectTitle.includes('无法') || rejectTitle.includes('不是')
      if (isRejected) {
        setError(`无法生成行程：${rejectTitle}。TripAI 仅支持地球上真实城市的旅行规划。`)
        clearGenState()
        return
      }
      const diag = {
        hasTitle: !!itinerary.title,
        daysType: typeof days,
        daysLength: Array.isArray(days) ? days.length : 0,
        contextKeys: Object.keys(context),
        attractionsCount: Array.isArray(context.attractions) ? context.attractions.length : 'N/A',
        foodCount: Array.isArray(context.food) ? context.food.length : 'N/A',
      }
      console.error('[runSteps] 生成的行程为空, diagnostics:', diag)
      const emptyReason = !Array.isArray(days) ? '返回格式异常' : days.length === 0 ? '未生成任何天数' : '所有天数活动为空'
      setError(`行程生成失败：${emptyReason}，请重新创建`)
      try {
        await fetch(`/api/plans/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
          body: JSON.stringify({
            itinerary: { status: 'failed', error: `行程为空: ${emptyReason}` },
            version: 1,
          }),
        })
      } catch { /* ignore */ }
      clearGenState()
      return
    }

    // Save in background, show "view details" button
    // 队列已存库则跳过前端保存
    if (itinerary._saved) {
      delete itinerary._saved
      setGeneratingDone(true)
      clearGenState()
    } else {
      setSaving(true)
      try {
        const headers = { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) }
        const saveRes = await fetch(`/api/plans/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            itinerary: { ...itinerary, status: 'completed' },
            version: 1,
            is_public: true,
            title: itinerary.title && /^\[.+]/.test(itinerary.title) ? itinerary.title : undefined,
          }),
        })
        if (!saveRes.ok) {
          const freshRes = await fetch(`/api/plans/${id}`)
          if (freshRes.ok) {
            const freshPlan = await freshRes.json()
            await fetch(`/api/plans/${id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({
                itinerary: { ...itinerary, status: 'completed' },
                version: freshPlan.version || Date.now(),
                is_public: true,
                title: itinerary.title && /^\[.+]/.test(itinerary.title) ? itinerary.title : undefined,
              }),
            })
          }
        }
      } catch (err) {
        console.error('保存行程失败:', err)
      }
      setSaving(false)
      setGeneratingDone(true)
      clearGenState()
    }
  }

  if (loading) {
    return (
      <div className="loading-wrapper" style={{ minHeight: '60vh' }}>
        <div className="loading-spinner" />
        <div className="loading-text">加载行程中...</div>
      </div>
    )
  }

  if (error && !plan?.itinerary?.days) {
    return (
      <div className="container" style={{ paddingTop: '8rem' }}>
        <div className="msg msg-error">{error}</div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="empty-state" style={{ paddingTop: '8rem' }}>
        <div className="empty-state-icon">😕</div>
        <div className="empty-state-title">行程不存在</div>
      </div>
    )
  }

  const isPending = plan.status === 'pending' && currentStep >= 0

  return (
    <div>
      <section className="plan-hero">
        <div className="plan-hero-bg" />
        <div className="container plan-hero-content">
          <h1 className="plan-hero-title">{plan.itinerary?.title || plan.title}</h1>
          <div className="plan-hero-meta">
            <span>📍 {resolvedCity || '加载中...'}</span>
            <span>📅 {(function() { try { const d = JSON.parse(plan.params).days; return typeof d === 'string' ? d : `${d}天` } catch { return '?' } })()}</span>
          </div>
        </div>
      </section>

      <section className="section plan-steps-section">
        <div className="container">
          {isPending ? (
            <div style={{ maxWidth: '700px', margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  🤖 AI 正在逐步为你规划行程
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>
                  每一步都基于真实数据和 AI 分析
                </div>
              </div>

              {STEPS.map((step, i) => {
                const result = stepResults[step.key]
                const stepError = stepErrors[step.key]
                const hasResult = !!result
                const isActive = !generatingDone && !hasResult && !stepError && i === currentStep
                const isCompleted = generatingDone || hasResult || !!stepError
                const isWaiting = !isActive && !isCompleted

                let borderClass = 'step-card-border-waiting'
                if (isActive) borderClass = 'step-card-border-active'
                else if (isCompleted) borderClass = 'step-card-border-done'

                let headerClass = 'step-header-waiting'
                if (isActive) headerClass = 'step-header-active'
                else if (isCompleted) headerClass = 'step-header-done'

                let iconClass = 'step-icon-waiting'
                if (isCompleted) iconClass = 'step-icon-done'
                else if (isActive) iconClass = 'step-icon-active'

                let titleClass = 'step-title-waiting'
                if (isActive || isCompleted) titleClass = 'step-title-done'

                return (
                  <div
                    key={step.key}
                    className={`step-card ${borderClass} ${isWaiting ? 'step-card-waiting' : ''}`}
                  >
                    <div className={`step-header ${headerClass}`}>
                      <div className={`step-icon ${iconClass}`}>
                        {isCompleted ? '✓' : step.icon}
                      </div>
                      <div className={`step-title ${titleClass}`}>
                        {step.title}
                      </div>
                      {isActive && (
                        <div className="loading-spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }} />
                      )}
                      {isCompleted && !stepError && (
                        <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 500 }}>完成</span>
                      )}
                      {stepError && (
                        <span style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>跳过</span>
                      )}
                    </div>

                    {isActive && !result && (
                      <div className="step-body step-body-waiting">
                        {step.waiting}
                      </div>
                    )}

                    {result && (
                      <div className="step-body">
                        <StepResult step={step.key} data={result} />
                      </div>
                    )}

                    {stepError && !result && (
                      <div className="step-error-body">
                        {stepError}（已跳过，继续后续步骤）
                      </div>
                    )}
                  </div>
                )
              })}
              {showTransition && (
                <div style={{
                  margin: '0.5rem 0',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-xl)',
                  border: '1px solid var(--primary)',
                  background: 'linear-gradient(135deg, rgba(14,165,233,0.06), rgba(99,102,241,0.06))',
                  animation: 'fadeIn 0.5s ease',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.75rem',
                  }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--primary), var(--gradient-end))',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.1rem',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}>
                      ✨
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary-dark)' }}>
                        天气数据就绪，开始深度分析
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        AI 正在结合天气、景点、美食为你规划...
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            {generatingDone && (
              <div style={{
                marginTop: '1rem',
                display: 'flex',
                justifyContent: 'center',
                gap: '0.75rem',
              }}>
                <button
                  className="plan-view-btn"
                  onClick={() => {
                    const tokenParam = editToken ? `?token=${editToken}` : ''
                    navigate(`/plan/${id}${tokenParam}`, { replace: true })
                  }}
                  style={{
                    padding: '0.75rem 2rem',
                    background: 'var(--primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-lg)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 8px rgba(79,70,229,0.3)',
                  }}
                  onMouseEnter={e => e.target.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.target.style.transform = 'none'}
                >
                  {saving ? '保存中...' : '查看行程详情 →'}
                </button>
              </div>
            )}
            </div>
          ) : plan.status === 'failed' ? (
            <div className="msg msg-error">
              行程生成失败：{plan.itinerary?.error || '未知错误'}
            </div>
          ) : (
            <div className="timeline">
              {(() => {
                const days = plan.itinerary?.days || []
                const isSingleDay = days.length === 1
                return days.map((day, index) => {
                  const periods = groupByTimePeriod(day.activities)
                  const dayDate = getDayDate(startDate, index)
                  const dayDateDisplay = dayDate ? getDateDisplay(dayDate) : null
                  const isHoliday = dayDateDisplay && !dayDateDisplay.match(/周[一二三四五]$/)
                  return (
                    <div key={index} className="timeline-day">
                      <div className="timeline-dot" />
                      {!isSingleDay && (
                        <h2 className="timeline-day-title" style={isHoliday ? { color: 'var(--primary)' } : undefined}>
                          📅 第 {day.day} 天{dayDateDisplay ? ` · ${dayDateDisplay}` : ''}
                        </h2>
                      )}
                      {periods.map((period) => (
                        <div key={period.key} style={{ marginBottom: '0.5rem' }}>
                          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', paddingLeft: '0.25rem' }}>
                            {period.icon} {period.label}
                          </h3>
                          {period.activities.map((activity, actIndex) => (
                            <div key={actIndex} className="activity-card">
                              <div
                                className="activity-card-image"
                                style={{
                                  background: `linear-gradient(135deg, hsl(${(actIndex * 60) % 360}, 70%, 65%), hsl(${(actIndex * 60 + 40) % 360}, 70%, 55%))`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '2rem',
                                }}
                              >
                                🏛️
                              </div>
                              <div className="activity-card-content">
                                <h4 className="activity-card-name">{activity.name}</h4>
                                <p className="activity-card-desc">{activity.description}</p>
                                <div className="activity-card-tags">
                                  {activity.time && <span className="activity-tag">⏰ {activity.time}</span>}
                                  {activity.duration > 0 && <span className="activity-tag">⌛ {activity.duration}分钟</span>}
                                  {(() => { const raw = toLocation(activity.location); const resolved = raw || resolvedLocations[activity.name]; return resolved ? <span className="activity-tag">📍 {resolved}</span> : null })()}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </section>

      <footer className="footer">
        <div className="container">TripAI — AI 驱动的旅行规划助手</div>
      </footer>
    </div>
  )
}

function StepResult({ step, data }) {
  if (!data) return null

  const animStyle = (i) => ({
    opacity: 0,
    animation: 'slideIn 0.8s ease forwards',
    animationDelay: `${i}s`,
  })

  if (step === 'weather') {
    const live = data.live
    const forecasts = data.forecasts || []
    if (!live && forecasts.length === 0) return <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>暂无天气数据</div>
    return (
      <div>
        {live && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: forecasts.length > 0 ? '0.75rem' : 0 }}>
            {[
              { label: '当前天气', value: live.weather, icon: '🌤️' },
              { label: '温度', value: `${live.temperature}°C`, icon: '🌡️' },
            ].map(item => (
              <div key={item.label} style={{ padding: '0.5rem 0.65rem', background: 'var(--bg-card-solid)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginBottom: '0.15rem' }}>{item.icon} {item.label}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
        {forecasts.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.25rem', WebkitOverflowScrolling: 'touch' }}>
            {forecasts.map((f, i) => (
              <div key={i} style={{
                flexShrink: 0,
                padding: '0.5rem 0.65rem',
                background: 'var(--bg-card-solid)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-light)',
                textAlign: 'center',
                minWidth: '80px',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '0.2rem' }}>
                  {f.date.slice(5)}
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {f.dayweather}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>
                  {f.nighttemp}°~{f.daytemp}°
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (step === 'explore') {
    const sections = [
      { icon: '📌', label: '城市概况', content: data.overview, bg: 'linear-gradient(135deg, hsl(200, 70%, 60%), hsl(220, 70%, 50%))' },
      { icon: '🌸', label: '季节提示', content: data.best_season, bg: 'linear-gradient(135deg, hsl(150, 70%, 60%), hsl(170, 70%, 50%))' },
      { icon: '🎭', label: '文化特色', content: data.culture, bg: 'linear-gradient(135deg, hsl(30, 70%, 60%), hsl(50, 70%, 50%))' },
      { icon: '🚄', label: '交通建议', content: data.transport_tips, bg: 'linear-gradient(135deg, hsl(260, 70%, 60%), hsl(280, 70%, 50%))' },
    ].filter(s => s.content)
    if (sections.length === 0) return <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>暂无数据</div>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {sections.map((s, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem',
            padding: '0.5rem 0.6rem',
            background: 'var(--bg-card-solid)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)',
            ...animStyle(i),
          }}>
            <span style={{
              width: '1.5rem',
              height: '1.5rem',
              borderRadius: '50%',
              background: s.bg,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              flexShrink: 0,
            }}>
              {s.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                {s.label}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {s.content}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (step === 'attractions') {
    const items = Array.isArray(data) ? data : []
    if (items.length === 0) return <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>暂无数据</div>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem',
            padding: '0.5rem 0.6rem',
            background: 'var(--bg-card-solid)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)',
            ...animStyle(i),
          }}>
            <span style={{
              width: '1.5rem',
              height: '1.5rem',
              borderRadius: '50%',
              background: `linear-gradient(135deg, hsl(${i * 35}, 70%, 60%), hsl(${i * 35 + 30}, 70%, 50%))`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                {item.name}
                {item.level === 'must' ? (
                  <span style={{ padding: '0.1rem 0.45rem', background: '#fef2f2', borderRadius: 'var(--radius-full)', fontSize: '0.68rem', color: '#dc2626', fontWeight: 500, border: '1px solid #fecaca' }}>
                    必去
                  </span>
                ) : item.level === 'optional' ? (
                  <span style={{ padding: '0.1rem 0.45rem', background: '#f0f9ff', borderRadius: 'var(--radius-full)', fontSize: '0.68rem', color: '#2563eb', fontWeight: 500, border: '1px solid #bfdbfe' }}>
                    可选
                  </span>
                ) : null}
                {item.estimated_duration > 0 && (
                  <span style={{ padding: '0.1rem 0.4rem', background: 'var(--bg-card)', borderRadius: 'var(--radius-full)', fontSize: '0.68rem', color: 'var(--text-light)', fontWeight: 400 }}>
                    ⏱️ {item.estimated_duration >= 60 ? `${Math.floor(item.estimated_duration / 60)}小时${item.estimated_duration % 60 > 0 ? `${item.estimated_duration % 60}分` : ''}` : `${item.estimated_duration}分钟`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                {item.description}
              </div>
              {item.reason && (
                <div style={{ fontSize: '0.75rem', color: 'var(--primary-dark)', marginTop: '0.15rem' }}>
                  💡 {item.reason}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (step === 'food') {
    const items = Array.isArray(data) ? data : []
    if (items.length === 0) return <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>暂无数据</div>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem',
            padding: '0.5rem 0.6rem',
            background: 'var(--bg-card-solid)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)',
            ...animStyle(i),
          }}>
            <span style={{
              width: '1.5rem',
              height: '1.5rem',
              borderRadius: '50%',
              background: `linear-gradient(135deg, hsl(${i * 25 + 30}, 70%, 60%), hsl(${i * 25 + 60}, 70%, 50%))`,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {item.name}
                {item.type && (
                  <span style={{
                    marginLeft: '0.4rem',
                    padding: '0.1rem 0.4rem',
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.7rem',
                    color: 'var(--text-light)',
                    fontWeight: 400,
                  }}>
                    {item.type}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                {item.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (step === 'generate') {
    const days = data.days || []
    const isSingleDay = days.length === 1
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {days.map((day, idx) => {
          const periods = groupByTimePeriod(day.activities)
          const dayDate = getDayDate(startDate, idx)
          const dayDateDisplay = dayDate ? getDateDisplay(dayDate) : null
          return (
            <div key={day.day} style={{
              background: 'var(--bg-card-solid)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-light)',
              padding: '1rem',
              ...animStyle(idx),
            }}>
              {!isSingleDay && (
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  📅 第 {day.day} 天{dayDateDisplay ? ` · ${dayDateDisplay}` : ''}
                </div>
              )}
              {periods.map(period => (
                <div key={period.key} style={{ marginBottom: '0.35rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', paddingLeft: '0.25rem' }}>
                    {period.icon} {period.label}
                  </div>
                  {period.activities.map((act, ai) => {
                    const isMeal = /^(早|午|晚)餐/.test(act.name)
                    return (
                      <div key={ai} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.45rem 0.6rem',
                        background: isMeal ? 'rgba(254, 243, 199, 0.5)' : 'var(--bg-card)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '0.2rem',
                      }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{act.time}</span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1 }}>{act.name}</span>
                        {act.duration > 0 && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>
                            {act.duration >= 60 ? `${Math.floor(act.duration / 60)}h${act.duration % 60 > 0 ? `${act.duration % 60}m` : ''}` : `${act.duration}m`}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  return <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>数据加载中...</div>
}

export default Plan

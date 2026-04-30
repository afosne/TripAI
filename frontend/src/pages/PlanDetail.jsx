import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { getDateDisplay } from '../utils/holidays'
import { isCoord, resolveLocation } from '../utils/location'
import { groupByTimePeriod, getDayDate } from '../utils/plan'

function toText(val) {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (Array.isArray(val)) return val.join('、')
  if (typeof val === 'object') return Object.values(val).map(v => typeof v === 'string' ? v : '').filter(Boolean).join('\n')
  return String(val)
}

function toLocation(val) {
  const text = toText(val).trim()
  if (isCoord(text)) return ''
  return text
}

function NavMenu({ activityName, cityName, getNavLinks, onClose }) {
  const [links, setLinks] = useState(null)

  useEffect(() => {
    getNavLinks(activityName, cityName).then(setLinks)
  }, [activityName, cityName])

  if (!links) return <div className="nav-menu"><div style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-light)' }}>加载中...</div></div>

  return (
    <div className="nav-menu">
      {links.map((item, i) => (
        <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="nav-menu-item" onClick={onClose}>
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </a>
      ))}
    </div>
  )
}

function PlanDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const editToken = searchParams.get('token') || ''
  const [tokenPopupVisible, setTokenPopupVisible] = useState(!!editToken)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedActivity, setExpandedActivity] = useState(null)
  const [activityDetails, setActivityDetails] = useState({})
  const [activityImages, setActivityImages] = useState(() => {
    try {
      const raw = localStorage.getItem('activity_images_cache')
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      const now = Date.now()
      const valid = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (v.ts && now - v.ts < 30 * 24 * 60 * 60 * 1000) {
          valid[k] = v.url
        }
      }
      return valid
    } catch { return {} }
  })
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [geoCache, setGeoCache] = useState({})
  const [reviews, setReviews] = useState([])
  const [userRating, setUserRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [reviewNickname, setReviewNickname] = useState('')
  const [reviewEmail, setReviewEmail] = useState('')
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [togglingPublic, setTogglingPublic] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [resolvedCity, setResolvedCity] = useState('')
  const [resolvedLocations, setResolvedLocations] = useState({})

  // 聊天面板
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [chatSuggestion, setChatSuggestion] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const chatMessagesRef = useRef(null)
  const chatInputRef = useRef(null)

  const fetchGeocode = async (name, cityName) => {
    if (geoCache[name]) return geoCache[name]
    try {
      const qp = new URLSearchParams({ name, city: cityName || '' })
      const res = await fetch(`/api/attraction/geocode?${qp}`)
      if (!res.ok) return null
      const data = await res.json()
      const geo = data.data
      if (geo) {
        setGeoCache(prev => ({ ...prev, [name]: geo }))
      }
      return geo
    } catch {
      return null
    }
  }

  const handleNavigate = async (e, activityName, cityName) => {
    e.preventDefault()
    e.stopPropagation()
    const geo = await fetchGeocode(activityName, cityName)
    let navUrl
    if (geo && geo.lng && geo.lat) {
      navUrl = `https://uri.amap.com/navigation?to=${geo.lng},${geo.lat},${encodeURIComponent(geo.name || activityName)}&mode=transit&callnative=1`
    } else {
      navUrl = `https://uri.amap.com/search?keyword=${encodeURIComponent(activityName)}&city=${encodeURIComponent(cityName || '')}&callnative=1`
    }
    window.open(navUrl, '_blank')
  }

  const [navMenuOpen, setNavMenuOpen] = useState(null)

  const getNavLinks = async (activityName, cityName) => {
    const geo = await fetchGeocode(activityName, cityName)
    const name = geo?.name || activityName
    const encName = encodeURIComponent(name)
    const city = encodeURIComponent(cityName || '')
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

    if (geo && geo.lng && geo.lat) {
      const lng = geo.lng
      const lat = geo.lat
      if (isMobile) {
        return [
          { label: '高德地图', icon: '🗺️', url: `iosamap://path?sourceApplication=aitu&dlat=${lat}&dlon=${lng}&dname=${encName}&dev=0&t=1` },
          { label: '百度地图', icon: '📍', url: `baidumap://map/direction?destination=name:${encName}|latlng:${lat},${lng}&mode=transit&coord_type=gcj02` },
          { label: '腾讯地图', icon: '🧭', url: `qqmap://map/routeplan?type=transit&to=${encName}&tocoord=${lat},${lng}&referer=myapp` },
        ]
      }
      return [
        { label: '高德地图', icon: '🗺️', url: `https://uri.amap.com/navigation?to=${lng},${lat},${encName}&mode=transit&callnative=1` },
        { label: '百度地图', icon: '📍', url: `https://api.map.baidu.com/direction?destination=latlng:${lat},${lng}|name:${encName}&mode=transit&output=html` },
        { label: '腾讯地图', icon: '🧭', url: `https://apis.map.qq.com/uri/v1/routeplan?type=transit&to=${encName}&tocoord=${lat},${lng}&referer=myapp` },
      ]
    }
    if (isMobile) {
      return [
        { label: '高德地图', icon: '🗺️', url: `iosamap://search?sourceApplication=aitu&keyword=${encName}&city=${city}` },
        { label: '百度地图', icon: '📍', url: `baidumap://map/place/search?query=${encName}&city=${city}` },
        { label: '腾讯地图', icon: '🧭', url: `qqmap://map/search?keyword=${encName}&city=${city}&referer=myapp` },
      ]
    }
    return [
      { label: '高德地图', icon: '🗺️', url: `https://uri.amap.com/search?keyword=${encName}&city=${city}&callnative=1` },
      { label: '百度地图', icon: '📍', url: `https://api.map.baidu.com/place/search?query=${encName}&city=${city}` },
      { label: '腾讯地图', icon: '🧭', url: `https://apis.map.qq.com/uri/v1/search?keyword=${encName}&city=${city}&referer=myapp` },
    ]
  }

  const handleNavMenu = async (e, activityName, cityName) => {
    e.preventDefault()
    e.stopPropagation()
    const key = `${activityName}-nav`
    if (navMenuOpen === key) {
      setNavMenuOpen(null)
      return
    }
    setNavMenuOpen(key)
  }

  useEffect(() => {
    if (!navMenuOpen) return
    const close = (e) => {
      if (!e.target.closest('.nav-trigger-btn') && !e.target.closest('.nav-menu')) {
        setNavMenuOpen(null)
      }
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [navMenuOpen])

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const tokenQuery = editToken ? `?token=${editToken}` : ''
        const response = await fetch(`/api/plans/${id}${tokenQuery}`)
        if (!response.ok) throw new Error('获取行程失败')
        const data = await response.json()
        setPlan(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchPlan()

    const fetchReviews = async () => {
      try {
        const res = await fetch(`/api/plans/${id}/reviews`)
        if (res.ok) {
          const data = await res.json()
          setReviews(data.reviews || [])
        }
      } catch { /* ignore */ }
    }
    fetchReviews()
  }, [id, editToken])

  // 自动打开管理面板
  useEffect(() => {
    if (plan?.editable) setManageOpen(true)
  }, [plan?.editable])

  // 解析坐标形式的城市名和活动地点
  useEffect(() => {
    if (!plan) return
    const rawCity = (() => { try { return JSON.parse(plan.params).destination || plan.city } catch { return plan.city } })()
    if (isCoord(rawCity)) {
      resolveLocation(rawCity).then(name => setResolvedCity(name))
    } else {
      setResolvedCity(rawCity)
    }
    const days = plan.itinerary?.days || []
    const tasks = []
    const map = {}
    days.forEach(d => (d.activities || []).forEach((act) => {
      const loc = toText(act.location).trim()
      const actName = act.name
      if (isCoord(loc) && actName) {
        tasks.push(resolveLocation(loc).then(name => { map[actName] = name }))
      }
    }))
    if (tasks.length) Promise.all(tasks).then(() => setResolvedLocations(map))
  }, [plan])

  // Token 提示弹窗 5s 自动关闭
  useEffect(() => {
    if (!tokenPopupVisible) return
    const timer = setTimeout(() => setTokenPopupVisible(false), 5000)
    return () => clearTimeout(timer)
  }, [tokenPopupVisible])

  const handleSubmitReview = async () => {
    if (userRating === 0 || !reviewNickname.trim()) return
    setSubmittingReview(true)
    try {
      const res = await fetch(`/api/plans/${id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'visitor_' + Math.random().toString(36).slice(2, 8),
          nickname: reviewNickname.trim(),
          email: reviewEmail.trim(),
          rating: userRating,
          comment: reviewComment,
        }),
      })
      if (res.ok) {
        setReviewSubmitted(true)
        setUserRating(0)
        setReviewNickname('')
        setReviewEmail('')
        setReviewComment('')
        const data = await res.json()
        setReviews(prev => [...prev, {
          id: data.review_id,
          nickname: reviewNickname.trim(),
          rating: userRating,
          comment: reviewComment,
          created_at: new Date().toISOString(),
        }])
        const planRes = await fetch(`/api/plans/${id}`)
        if (planRes.ok) {
          const planData = await planRes.json()
          setPlan(planData)
        }
      }
    } catch { /* ignore */ }
    setSubmittingReview(false)
  }

  const handleTogglePublic = async () => {
    setTogglingPublic(true)
    try {
      const newValue = !plan.is_public
      const res = await fetch(`/api/plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
        body: JSON.stringify({ is_public: newValue }),
      })
      if (res.ok) {
        setPlan(prev => ({ ...prev, is_public: newValue }))
      }
    } catch { /* ignore */ }
    setTogglingPublic(false)
  }

  const handleTokenVerify = async () => {
    if (!tokenInput.trim()) return
    setTokenError('')
    try {
      const res = await fetch(`/api/plans/${id}?token=${encodeURIComponent(tokenInput.trim())}`)
      if (!res.ok) throw new Error('验证失败')
      const data = await res.json()
      if (data.editable) {
        navigate(`/plan/${id}?token=${encodeURIComponent(tokenInput.trim())}`, { replace: true })
      } else {
        setTokenError('密钥不正确')
      }
    } catch {
      setTokenError('验证失败，请重试')
    }
  }

  const handleDeletePlan = () => {
    fetch(`/api/plans/${id}`, {
      method: 'DELETE',
      headers: editToken ? { 'X-Edit-Token': editToken } : {},
    })
    navigate('/', { replace: true })
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const handleExportText = () => {
    if (!plan?.itinerary?.days) return
    const isSingleDay = plan.itinerary.days.length === 1
    let text = `# ${plan.itinerary?.title || plan.title}\n\n`
    for (const day of plan.itinerary.days) {
      if (!isSingleDay) text += `## 第 ${day.day} 天\n\n`
      const periods = groupByTimePeriod(day.activities)
      for (const period of periods) {
        text += `### ${period.icon} ${period.label}\n\n`
        for (const act of period.activities) {
          text += `- **${act.name}**`
          if (act.time) text += ` (${act.time})`
          text += `\n  ${act.description}\n`
          if (toLocation(act.location) || resolvedLocations[act.name]) text += `  📍 ${toLocation(act.location) || resolvedLocations[act.name]}\n`
          text += '\n'
        }
      }
    }
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${plan.itinerary?.title || plan.title || '行程'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportImage = async () => {
    if (!plan?.itinerary?.days) return
    const { toPng } = await import('html-to-image')
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const isSingleDay = plan.itinerary.days.length === 1
    const _pp = (() => { try { return JSON.parse(plan.params) } catch { return {} } })()
    const _startDate = _pp.start_date || plan.start_date

    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;'
    document.body.appendChild(container)

    const images = []

    const renderActivities = (acts) => acts.map((act) => `
      <div style="
        padding:1.1rem 1.25rem;border-radius:0.75rem;
        background:${isDark ? '#1e293b' : '#ffffff'};
        border:1px solid ${isDark ? 'rgba(71,85,105,0.4)' : 'rgba(148,163,184,0.25)'};
      ">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
          <span style="font-size:1rem;font-weight:700;">${act.name}</span>
          ${act.time ? `<span style="font-size:0.75rem;color:${isDark ? '#64748b' : '#94a3b8'}">⏰ ${act.time}</span>` : ''}
          ${act.duration ? `<span style="font-size:0.75rem;color:${isDark ? '#64748b' : '#94a3b8'}">⌛ ${act.duration}分钟</span>` : ''}
        </div>
        <div style="font-size:0.85rem;line-height:1.6;color:${isDark ? '#94a3b8' : '#475569'};">
          ${act.description}
        </div>
        ${(toLocation(act.location) || resolvedLocations[act.name]) ? `<div style="font-size:0.8rem;margin-top:0.3rem;color:${isDark ? '#64748b' : '#94a3b8'}">📍 ${toLocation(act.location) || resolvedLocations[act.name]}</div>` : ''}
      </div>
    `).join('')

    try {
      for (let i = 0; i < plan.itinerary.days.length; i++) {
        const day = plan.itinerary.days[i]
        const periods = groupByTimePeriod(day.activities)

        const card = document.createElement('div')
        card.style.cssText = `
          width:680px;padding:2.5rem;font-family:'Inter',-apple-system,sans-serif;
          background:${isDark ? '#0f172a' : '#f0f4f8'};color:${isDark ? '#e2e8f0' : '#0f172a'};
        `

        const dayDateStr = (() => { try { const d = getDayDate(_startDate, i); return d ? getDateDisplay(d) : '' } catch { return '' } })()
        const cityDisplay = resolvedCity || ''
        const dayHeader = isSingleDay
          ? `<div style="font-size:0.9rem;color:${isDark ? '#94a3b8' : '#64748b'};margin-bottom:1.5rem;">${cityDisplay}</div>`
          : `<div style="font-size:0.9rem;color:${isDark ? '#94a3b8' : '#64748b'};margin-bottom:1.5rem;">📅 第 ${day.day} 天 · ${dayDateStr || cityDisplay}</div>`

        const periodSections = periods.map(p => `
          <div style="margin-bottom:0.75rem;">
            <div style="font-size:0.85rem;font-weight:600;color:${isDark ? '#94a3b8' : '#64748b'};margin-bottom:0.4rem;">${p.icon} ${p.label}</div>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">
              ${renderActivities(p.activities)}
            </div>
          </div>
        `).join('')

        card.innerHTML = `
          <div style="font-size:1.5rem;font-weight:800;margin-bottom:0.5rem;color:${isDark ? '#38bdf8' : '#0ea5e9'};">
            ${plan.itinerary?.title || plan.title}
          </div>
          ${dayHeader}
          ${periodSections}
          <div style="margin-top:1.5rem;font-size:0.7rem;color:${isDark ? '#475569' : '#cbd5e1'};text-align:right;">
            TripAI 生成
          </div>
        `

        container.appendChild(card)
        await new Promise(r => setTimeout(r, 50))

        const dataUrl = await toPng(card, {
          backgroundColor: isDark ? '#0f172a' : '#f0f4f8',
          pixelRatio: 2,
        })
        images.push({ url: dataUrl, name: `${plan.itinerary?.title || plan.title || '行程'}_第${day.day}天.png` })

        container.removeChild(card)
      }

      for (const img of images) {
        const a = document.createElement('a')
        a.href = img.url
        a.download = img.name
        a.click()
        await new Promise(r => setTimeout(r, 300))
      }
    } catch {
      window.print()
    } finally {
      document.body.removeChild(container)
    }
  }

  const imageLoadingRef = useRef({})

  useEffect(() => {
    if (!plan?.itinerary?.days) return
    const allActivities = plan.itinerary.days.flatMap(d => d.activities || [])
    allActivities.forEach((act) => {
      if (!activityImages[act.name]) {
        if (imageLoadingRef.current[act.name]) return
        imageLoadingRef.current[act.name] = true
        const qp = new URLSearchParams({ name: act.name })
        fetch(`/api/attraction/image?${qp}`).then(r => r.ok ? r.json() : null).then(data => {
          if (data?.url) {
            setActivityImages(prev => {
              const next = { ...prev, [act.name]: data.url }
              // data URL 太大不存 localStorage，只存外部链接
              if (data.url.startsWith('http')) {
                try {
                  const raw = localStorage.getItem('activity_images_cache')
                  const cache = raw ? JSON.parse(raw) : {}
                  cache[act.name] = { url: data.url, ts: Date.now() }
                  localStorage.setItem('activity_images_cache', JSON.stringify(cache))
                } catch { /* ignore */ }
              }
              return next
            })
          }
        }).catch(() => {}).finally(() => { delete imageLoadingRef.current[act.name] })
      }
    })
  }, [plan])

  const handleActivityClick = async (activity) => {
    const key = activity.name
    if (expandedActivity === key) {
      setExpandedActivity(null)
      return
    }
    setExpandedActivity(key)
    if (activityDetails[key]) return
    setLoadingDetail(true)
    try {
      const qp = new URLSearchParams({ name: activity.name, city: plan.city || '' })
      const res = await fetch(`/api/attraction/detail?${qp}`)
      if (!res.ok) throw new Error('获取详情失败')
      const data = await res.json()
      setActivityDetails(prev => ({ ...prev, [key]: data.data }))
    } catch (err) {
      setActivityDetails(prev => ({ ...prev, [key]: { error: err.message } }))
    } finally {
      setLoadingDetail(false)
    }
  }

  // ========== 聊天逻辑 ==========

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || chatStreaming) return
    const userMsg = chatInput.trim()
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setChatInput('')
    setChatStreaming(true)
    setChatSuggestion(null)
    setChatMessages(prev => [...prev, { role: 'ai', content: '' }])

    try {
      const res = await fetch(`/api/plans/${id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
        body: JSON.stringify({ feedback: userMsg }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '请求失败')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let fullContent = ''

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
              fullContent += dataStr
              setChatMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: 'ai', content: fullContent.replace(/【[\s\S]*?】/g, '').trim() }
                return next
              })
            } else if (currentEvent === 'done') {
              const jsonMatch = fullContent.match(/【(.+?)】/s)
              if (jsonMatch) {
                try {
                  const sug = JSON.parse(jsonMatch[1])
                  setChatSuggestion(sug)
                } catch { /* ignore */ }
              }
            } else if (currentEvent === 'error') {
              let msg = dataStr
              try { msg = JSON.parse(dataStr).message || dataStr } catch { /* keep raw */ }
              throw new Error(msg)
            }
          }
        }
      }
    } catch (err) {
      setChatMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', content: `出错了：${err.message}` }
        return next
      })
    } finally {
      setChatStreaming(false)
      setTimeout(() => {
        chatMessagesRef.current?.scrollTo({ top: chatMessagesRef.current.scrollHeight, behavior: 'smooth' })
      }, 50)
    }
  }, [chatInput, chatStreaming, id])

  const handleAdopt = useCallback(async () => {
    if (!chatSuggestion || !plan?.itinerary?.days) return

    const { day, index, activity } = chatSuggestion
    const dayIndex = day - 1 // AI 返回的 day 从 1 开始
    if (dayIndex < 0 || dayIndex >= plan.itinerary.days.length) return

    const newDays = [...plan.itinerary.days]
    const newActivities = [...newDays[dayIndex].activities]

    if (activity === null) {
      // 删除
      newActivities.splice(index, 1)
    } else if (index === -1) {
      // 追加
      newActivities.push(activity)
    } else {
      // 替换
      newActivities[index] = { ...newActivities[index], ...activity }
    }
    newDays[dayIndex] = { ...newDays[dayIndex], activities: newActivities }
    const newItinerary = { ...plan.itinerary, days: newDays, status: 'completed' }

    try {
      const headers = { 'Content-Type': 'application/json', ...(editToken ? { 'X-Edit-Token': editToken } : {}) }
      const saveRes = await fetch(`/api/plans/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ itinerary: newItinerary, version: plan.version }),
      })
      if (!saveRes.ok) {
        const freshRes = await fetch(`/api/plans/${id}`)
        if (freshRes.ok) {
          const fresh = await freshRes.json()
          await fetch(`/api/plans/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ itinerary: newItinerary, version: fresh.version }),
          })
        }
      }
      setPlan(prev => ({ ...prev, itinerary: newItinerary, version: Date.now() }))
      setActivityDetails({})
      setChatMessages(prev => [...prev, { role: 'system', content: '✅ 已更新行程' }])
      setChatSuggestion(null)
      // 展开修改的活动卡片并滚动定位
      const targetName = activity === null ? null : (activity.name || newActivities[index]?.name)
      if (targetName) {
        setExpandedActivity(targetName)
        setTimeout(() => {
          const el = document.getElementById(`activity-${targetName}`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'system', content: '保存失败，请重试' }])
    }
  }, [chatSuggestion, plan, id])

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [chatMessages])

  const handleChatKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleChatSend()
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

  if (error || !plan) {
    return (
      <div className="container" style={{ paddingTop: '8rem' }}>
        <div className="msg msg-error">{error || '行程不存在'}</div>
      </div>
    )
  }

  const city = (() => { try { return JSON.parse(plan.params).destination || plan.city } catch { return plan.city } })()
  const planParams = (() => { try { return JSON.parse(plan.params) } catch { return {} } })()
  const startDate = planParams.start_date || plan.start_date
  const days = plan.itinerary?.days || []
  const displayTitle = plan.itinerary?.title || plan.title

  return (
    <div>
      <section className="plan-hero">
        <div className="plan-hero-bg" />
        <div className="container plan-hero-content">
          <h1 className="plan-hero-title">{displayTitle}</h1>
          <div className="plan-hero-meta">
            <span>📍 {resolvedCity || '加载中...'}</span>
            <span>📅 {days.length}天</span>
            <span>⭐ {plan.avg_rating ? plan.avg_rating.toFixed(1) : '—'}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="plan-detail-layout">
            {/* 左侧管理栏 - 始终显示 */}
            <aside className={`manage-sidebar${manageOpen ? ' manage-sidebar-open' : ''}`} style={{ marginTop: days.length > 1 ? '55px' : '20px' }}>
              <div className="manage-sidebar-inner">
                <div className="manage-title">
                  <span>⚙️ 管理</span>
                  <button className="manage-close-btn" onClick={() => setManageOpen(false)}>✕</button>
                </div>

                <div className="manage-section">
                  <button onClick={handleCopyLink} className="manage-action-btn">
                    {copied ? '✅ 已复制' : '🔗 复制链接'}
                  </button>
                  <button onClick={handleExportText} className="manage-action-btn">
                    📝 文字导出
                  </button>
                  <button onClick={handleExportImage} className="manage-action-btn">
                    🖼️ 图片导出
                  </button>
                </div>

                {plan.editable ? (
                  <>
                    <div className="manage-section">
                      <button onClick={handleTogglePublic} disabled={togglingPublic}
                        className={`manage-toggle ${plan.is_public ? 'manage-toggle-on' : 'manage-toggle-off'}`}>
                        {plan.is_public ? '🌍 公开' : '🔒 私有'}
                      </button>
                    </div>

                    <div className="manage-section">
                      <button onClick={() => setDeleteConfirmOpen(true)} className="manage-action-btn manage-action-danger">
                        🗑️ 删除行程
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="manage-token-form">
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginBottom: '0.5rem', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                      🔒 输入管理密钥解锁编辑
                    </div>
                    <input
                      value={tokenInput}
                      onChange={(e) => { setTokenInput(e.target.value); setTokenError('') }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleTokenVerify() }}
                      placeholder="粘贴密钥..."
                      className="manage-token-input"
                    />
                    {tokenError && (
                      <div className="manage-token-error">{tokenError}</div>
                    )}
                    <button onClick={handleTokenVerify} disabled={!tokenInput.trim()} className="manage-token-submit">
                      验证
                    </button>
                  </div>
                )}
              </div>
            </aside>

            {/* 中间：行程 + 评价 */}
            <div className="plan-detail-main">
              <div className="timeline">
                {(() => {
                  const isSingleDay = days.length === 1
                  return days.map((day, dayIndex) => {
                    const periods = groupByTimePeriod(day.activities)
                    const dayDate = getDayDate(startDate, dayIndex)
                    const dayDateDisplay = dayDate ? getDateDisplay(dayDate) : null
                    const isHoliday = dayDateDisplay && !dayDateDisplay.match(/周[一二三四五]$/)
                    return (
                      <div key={dayIndex} className="timeline-day">
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
                            {period.activities.map((activity, actIndex) => {
                              const key = activity.name
                              const isExpanded = expandedActivity === key
                              const detail = activityDetails[key]
                              const imageUrl = activityImages[key]

                              return (
                                <div key={actIndex} id={`activity-${key}`} className={`detail-card ${isExpanded ? 'detail-card-expanded' : ''}`}>
                                  <div
                                    onClick={() => handleActivityClick(activity)}
                                    className={`detail-card-header ${isExpanded ? 'detail-card-header-active' : 'detail-card-header-default'}`}
                                  >
                                    <div
                                      className="detail-card-thumb"
                                      style={!imageUrl ? {
                                        background: `linear-gradient(135deg, hsl(${(actIndex * 60) % 360}, 70%, 65%), hsl(${(actIndex * 60 + 40) % 360}, 70%, 55%))`,
                                      } : {}}
                                    >
                                      {imageUrl ? (
                                        <img src={imageUrl} alt={activity.name} loading="lazy" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                      ) : '🏛️'}
                                    </div>
                                    <div className="detail-card-info">
                                      <div className="detail-card-title">
                                        {activity.name}
                                        <span className={`detail-card-title-badge ${isExpanded ? 'detail-card-title-badge-active' : 'detail-card-title-badge-default'}`}>
                                          {isExpanded ? '收起' : '点击查看攻略'} ▾
                                        </span>
                                      </div>
                                      <p className="detail-card-desc">{activity.description}</p>
                                      <div className="activity-card-tags">
                                        {activity.time && <span className="activity-tag">⏰ {toText(activity.time)}</span>}
                                        {typeof activity.duration === 'number' && activity.duration > 0 && <span className="activity-tag">⌛ {activity.duration}分钟</span>}
                                        {(() => { const raw = toLocation(activity.location); const resolved = raw || resolvedLocations[activity.name]; return resolved ? <span className="activity-tag">📍 {resolved}</span> : null })()}
                                      </div>
                                    </div>
                                  </div>

                                  {isExpanded && (
                                    <div className="detail-card-body">
                                      {loadingDetail && !detail ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
                                          <div className="loading-spinner" style={{ width: '24px', height: '24px' }} />
                                          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>AI 正在生成「{activity.name}」的详细攻略...</span>
                                        </div>
                                      ) : detail?.error ? (
                                        <div className="msg msg-error">{detail.error}</div>
                                      ) : detail ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                          {detail.how_to_play && (<div className="detail-section"><div className="detail-section-title">🎯 怎么玩</div><div className="detail-section-content">{toText(detail.how_to_play)}</div></div>)}
                                          {detail.highlights?.length > 0 && (<div className="detail-section"><div className="detail-section-title">✨ 必看亮点</div><div className="detail-section-content"><div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>{detail.highlights.map((h, i) => (<span key={i} style={{ background: 'var(--bg-tertiary)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-primary)' }}>{h}</span>))}</div></div></div>)}
                                          {detail.recommended_duration && (<div className="detail-section"><div className="detail-section-title">⏱️ 建议时长</div><div className="detail-section-content">{toText(detail.recommended_duration)}</div></div>)}
                                          {detail.best_time && (<div className="detail-section"><div className="detail-section-title">⏰ 游览时间</div><div className="detail-section-content">{toText(detail.best_time)}</div></div>)}
                                  {detail.how_to_get && (
                                    <div className="detail-section">
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                        <div className="detail-section-title" style={{ marginBottom: 0 }}>🚇 怎么去</div>
                                        <div style={{ position: 'relative' }}>
                                          <button onClick={(e) => handleNavMenu(e, activity.name, city)} className="nav-trigger-btn">
                                            🧭 导航
                                          </button>
                                          {navMenuOpen === `${activity.name}-nav` && (
                                            <NavMenu
                                              activityName={activity.name}
                                              cityName={city}
                                              getNavLinks={getNavLinks}
                                              onClose={() => setNavMenuOpen(null)}
                                            />
                                          )}
                                        </div>
                                      </div>
                                      <div className="detail-section-content" style={{ marginTop: '0.4rem' }}>
                                        {toText(detail.how_to_get)}
                                      </div>
                                    </div>
                                  )}
                                  {detail.ticket_info && (<div className="detail-section"><div className="detail-section-title">🎫 门票信息</div><div className="detail-section-content">{toText(detail.ticket_info)}</div></div>)}
                                  {detail.tips && (<div className="detail-section"><div className="detail-section-title">💡 实用贴士</div><div className="detail-section-content">{toText(detail.tips)}</div></div>)}
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', textAlign: 'right', marginTop: '0.5rem' }}>
                                    {activityDetails[key]?.cached !== false ? '📦 已缓存' : '✨ 刚刚生成'}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
                  )
                })
              })()}
              </div>

              {/* 评价区 */}
              <section style={{ paddingTop: '2rem' }}>
                <div style={{
                  background: 'var(--bg-card-solid)', borderRadius: 'var(--radius-xl)', padding: '2rem',
                  boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)',
                }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-primary)' }}>
                    ⭐ 行程评价
                    {plan.avg_rating > 0 && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-light)', marginLeft: '0.75rem' }}>
                        {plan.avg_rating.toFixed(1)} 分 · {plan.rating_count || 0} 条评价
                      </span>
                    )}
                  </h3>
                  {!reviewSubmitted ? (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem' }}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <button key={star} onClick={() => setUserRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)}
                            style={{ fontSize: '1.75rem', color: (hoverRating || userRating) >= star ? '#f59e0b' : '#d1d5db', transition: 'color 0.15s, transform 0.15s', transform: (hoverRating || userRating) >= star ? 'scale(1.15)' : 'scale(1)', lineHeight: 1, padding: '0.1rem' }}>★</button>
                        ))}
                        {userRating > 0 && <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600, marginLeft: '0.5rem', alignSelf: 'center' }}>{['', '很差', '一般', '不错', '很好', '非常棒'][userRating]}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <input value={reviewNickname} onChange={(e) => setReviewNickname(e.target.value)} placeholder="昵称（必填）" className="form-input" style={{ flex: 1 }} />
                        <input value={reviewEmail} onChange={(e) => setReviewEmail(e.target.value)} placeholder="邮箱（选填）" type="email" className="form-input" style={{ flex: 1 }} />
                      </div>
                      <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="分享你的评价（可选）..." className="form-input" style={{ minHeight: '80px', resize: 'vertical', marginBottom: '0.75rem' }} />
                      <button onClick={handleSubmitReview} disabled={userRating === 0 || !reviewNickname.trim() || submittingReview} className="btn btn-primary" style={{ width: '100%' }}>{submittingReview ? '提交中...' : '提交评价'}</button>
                    </div>
                  ) : (
                    <div className="msg msg-success" style={{ marginBottom: '1.5rem' }}>✅ 评价提交成功，感谢你的反馈！</div>
                  )}
                  {reviews.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {reviews.map((review, i) => (
                        <div key={review.id || i} className="review-card" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                            {review.nickname && <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{review.nickname}</span>}
                            <span style={{ color: '#f59e0b', fontSize: '0.9rem', letterSpacing: '0.05em' }}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{review.created_at ? new Date(review.created_at).toLocaleDateString('zh-CN') : ''}</span>
                          </div>
                          {review.comment && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{review.comment}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 右侧：聊天面板 - 始终显示 */}
            <div className={`chat-panel${chatOpen ? ' chat-panel-open' : ''}`} style={{ marginTop: days.length > 1 ? '55px' : '20px' }}>
              <div className="chat-panel-header">
                <div className="chat-panel-title">✏️ AI 助手</div>
                <button className="chat-close-btn" onClick={() => setChatOpen(false)}>✕</button>
              </div>

              {!plan.editable ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔒</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>需要管理密钥</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    请在左侧「管理」面板中输入管理密钥以解锁 AI 助手
                  </div>
                  <button onClick={() => { setManageOpen(true); setChatOpen(false) }} className="btn btn-outline" style={{ fontSize: '0.85rem' }}>
                    打开管理面板
                  </button>
                </div>
              ) : (
              <>
              <div className="chat-messages" ref={chatMessagesRef}>
                {chatMessages.length === 0 && (
                  <div className="chat-msg chat-msg-system">
                    直接告诉我哪里不满意，比如"第二天故宫换成圆明园"或"第三天太赶了"
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.role === 'user' ? 'chat-msg-user' : msg.role === 'system' ? 'chat-msg-system' : 'chat-msg-ai'}`}>
                    {msg.content}
                    {msg.role === 'ai' && i === chatMessages.length - 1 && chatSuggestion && (
                      <button className="chat-adopt-btn" onClick={handleAdopt}>
                        ✅ 采纳这个方案
                      </button>
                    )}
                  </div>
                ))}
                {chatStreaming && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'ai' && !chatMessages[chatMessages.length - 1].content && (
                  <div className="chat-msg chat-msg-system">AI 正在思考...</div>
                )}
              </div>

              <div className="chat-input-area">
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder="说点什么..."
                  disabled={chatStreaming}
                  rows={1}
                />
                <button className="chat-send-btn" onClick={handleChatSend} disabled={!chatInput.trim() || chatStreaming}>
                  ➤
                </button>
              </div>
              </>
              )}
            </div>
          </div>
        </div>

        <button className="manage-fab" onClick={() => setManageOpen(!manageOpen)}>
          <span>☰</span>
        </button>
        <button className="chat-fab" onClick={() => setChatOpen(true)}>
          <span>✏️</span>
        </button>
      </section>

      <footer className="footer">
        <div className="container">TripAI — AI 驱动的旅行规划助手</div>
      </footer>

      {/* Token 提示弹窗 */}
      {tokenPopupVisible && editToken && (
        <div style={{
          position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 10000, maxWidth: '480px', width: '90%',
          background: 'var(--bg-card-solid)', borderRadius: 'var(--radius-xl)',
          padding: '1.25rem 1.5rem', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          border: '1px solid var(--primary)', animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>🎉 行程已生成，已自动解锁编辑</span>
            <button onClick={() => setTokenPopupVisible(false)} style={{ background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.6rem', lineHeight: 1.5 }}>
            收藏此链接可随时回来编辑行程，链接丢失将无法恢复编辑权限。
          </div>
          <div
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
                setTokenCopied(true)
                setTimeout(() => setTokenCopied(false), 2000)
              } catch { /* ignore */ }
            }}
            style={{
              padding: '0.6rem 0.8rem', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-light)', cursor: 'pointer',
              fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)',
              wordBreak: 'break-all', lineHeight: 1.4,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{window.location.href}</span>
            <span style={{
              padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-full)',
              background: tokenCopied ? '#059669' : 'var(--primary)', color: '#fff',
              fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {tokenCopied ? '已复制' : '点击复制'}
            </span>
          </div>
        </div>
      )}

      {deleteConfirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)',
        }} onClick={() => setDeleteConfirmOpen(false)}>
          <div style={{
            background: 'var(--bg-card-solid)', borderRadius: 'var(--radius-xl)',
            padding: '2rem', maxWidth: '380px', width: '90%',
            boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-light)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
              确定删除行程？
            </div>
            <div style={{ fontSize: '0.88rem', textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              删除后无法恢复，行程「{plan?.itinerary?.title || plan?.title}」将被永久移除。
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setDeleteConfirmOpen(false)} className="btn btn-outline" style={{ flex: 1 }}>
                取消
              </button>
              <button onClick={handleDeletePlan} disabled={deleting} className="btn" style={{
                flex: 1, background: '#dc2626', color: '#fff', border: 'none',
              }}>
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlanDetail

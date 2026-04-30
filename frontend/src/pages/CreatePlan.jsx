import { useState, useMemo, useEffect, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyzeDates } from '../utils/holidays'
import { POPULAR_CITIES } from '../utils/constants'

const AccommodationMap = lazy(() => import('../components/AccommodationMap.jsx'))

const QUICK_TAGS = [
  { emoji: '🏛️', label: '历史文化' },
  { emoji: '🍜', label: '美食探店' },
  { emoji: '🏔️', label: '自然风光' },
  { emoji: '🎢', label: '主题乐园' },
  { emoji: '🛍️', label: '购物休闲' },
  { emoji: '📸', label: '网红打卡' },
  { emoji: '♨️', label: '温泉养生' },
  { emoji: '🏖️', label: '海滨度假' },
  { emoji: '🎭', label: '艺术展览' },
  { emoji: '🧘', label: '休闲放松' },
  { emoji: '🍷', label: '酒庄品鉴' },
  { emoji: '🎪', label: '民俗体验' },
  { emoji: '🚴', label: '户外运动' },
  { emoji: '🌙', label: '夜晚生活' },
  { emoji: '👨‍👩‍👧‍👦', label: '亲子活动' },
  { emoji: '🎓', label: '研学旅行' },
]

const EXTRA_QUICK_TAGS = [
  { emoji: '👴', label: '有老人' },
  { emoji: '👶', label: '有小孩' },
  { emoji: '♿', label: '行动不便' },
  { emoji: '🤰', label: '孕妇出行' },
  { emoji: '🥬', label: '素食需求' },
  { emoji: '🚹', label: '无障碍需求' },
  { emoji: '💰', label: '预算有限' },
]

function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function diffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1
}

function analyzeCrowd(startDate, endDate) {
  const tips = []
  const totalDays = diffDays(startDate, endDate)
  const { weekdays, weekends, holidays, holidayNames } = analyzeDates(startDate, endDate)

  if (holidays > 0) {
    tips.push({ type: 'warning', text: `行程包含${holidayNames.join('、')}假期，景区人流密集，建议提前预约门票和酒店` })
  } else if (weekends > weekdays) {
    tips.push({ type: 'warning', text: '行程以周末为主，热门景点可能人流较多，建议提前预约' })
  } else {
    tips.push({ type: 'good', text: '行程以工作日为主，景点人流相对较少，体验更佳' })
  }

  const month = new Date(startDate).getMonth() + 1
  if (month === 1 || month === 2) {
    tips.push({ type: 'info', text: '📅 春节/寒假期间为旅游旺季，建议提前预订酒店' })
  } else if (month === 7 || month === 8) {
    tips.push({ type: 'warning', text: '☀️ 暑假期间为旅游旺季，景区人流密集' })
  } else if (month === 10) {
    tips.push({ type: 'warning', text: '🍂 国庆黄金周，建议避开 10.1-10.3 高峰期' })
  } else if (month >= 4 && month <= 5) {
    tips.push({ type: 'good', text: '🌸 春季气候宜人，五一前后注意避开小长假高峰' })
  } else if (month >= 9 && month <= 11) {
    tips.push({ type: 'good', text: '🍁 秋季是最佳旅行季节，天气舒适人流适中' })
  }

  return { totalDays, weekdays, weekends, holidays, holidayNames, tips }
}

const today = formatDate(new Date())

function CreatePlan() {
  const navigate = useNavigate()
  const [bgUrl, setBgUrl] = useState('')
  const [formData, setFormData] = useState({
    destination: '',
    start_date: '',
    end_date: '',
    preferences: [],
    extra_requirements: '',
    extra_tags: [],
    pace: 'moderate',
    arrival_time: '',
    departure_time: '',
    accommodation_lat: null,
    accommodation_lng: null,
    accommodation_name: '',
    accommodation_district: '',
  })
  const [customPref, setCustomPref] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  useEffect(() => {
    fetch('/api/bing-wallpaper').then(r => r.json()).then(d => { if (d.url) setBgUrl(d.url) }).catch(() => {})
  }, [])

  const filteredCities = useMemo(() => {
    const q = formData.destination.trim().toLowerCase()
    if (!q) return POPULAR_CITIES.slice(0, 20)
    return POPULAR_CITIES.filter(c => c.toLowerCase().includes(q)).slice(0, 20)
  }, [formData.destination])

  const crowdAnalysis = useMemo(() => {
    if (!formData.start_date || !formData.end_date) return null
    if (formData.start_date > formData.end_date) return null
    return analyzeCrowd(formData.start_date, formData.end_date)
  }, [formData.start_date, formData.end_date])

  const days = crowdAnalysis?.totalDays || 0

  const togglePreference = (label) => {
    setFormData(prev => ({
      ...prev,
      preferences: prev.preferences.includes(label)
        ? prev.preferences.filter(p => p !== label)
        : [...prev.preferences, label],
    }))
  }

  const addCustomPreference = () => {
    const trimmed = customPref.trim()
    if (!trimmed) return
    if (formData.preferences.includes(trimmed)) {
      setCustomPref('')
      return
    }
    setFormData(prev => ({ ...prev, preferences: [...prev.preferences, trimmed] }))
    setCustomPref('')
  }

  const handleCustomPrefKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustomPreference()
    }
  }

  const removePreference = (label) => {
    setFormData(prev => ({
      ...prev,
      preferences: prev.preferences.filter(p => p !== label),
    }))
  }

  const isCustomPref = (label) => {
    return !QUICK_TAGS.some(t => t.label === label)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.start_date || !formData.end_date) {
      setError('请选择旅行日期')
      return
    }
    if (formData.start_date > formData.end_date) {
      setError('结束日期不能早于开始日期')
      return
    }
    if (diffDays(formData.start_date, formData.end_date) > 30) {
      setError('旅行日期最长不能超过30天')
      return
    }

    const finalDays = days || diffDays(formData.start_date, formData.end_date)

    const extraReq = [formData.extra_tags.join('、'), formData.extra_requirements].filter(Boolean).join('。')

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: formData.destination,
          days: finalDays,
          preferences: formData.preferences,
          start_date: formData.start_date,
          end_date: formData.end_date,
          extra_requirements: extraReq,
          pace: formData.pace,
          arrival_time: formData.arrival_time,
          departure_time: formData.departure_time,
          accommodation_lat: formData.accommodation_lat,
          accommodation_lng: formData.accommodation_lng,
          accommodation_name: formData.accommodation_name,
          accommodation_district: formData.accommodation_district,
        }),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `创建失败 (${response.status})`)
      }
      const data = await response.json()
      setSuccess('行程创建成功，正在跳转...')
      setTimeout(() => navigate(`/plan/${data.plan_id}/generate`, {
        state: {
          params: {
            destination: formData.destination,
            days: finalDays,
            preferences: formData.preferences,
            start_date: formData.start_date,
            end_date: formData.end_date,
            extra_requirements: extraReq,
            pace: formData.pace,
            arrival_time: formData.arrival_time,
            departure_time: formData.departure_time,
            accommodation_lat: formData.accommodation_lat,
            accommodation_lng: formData.accommodation_lng,
            accommodation_name: formData.accommodation_name,
            accommodation_district: formData.accommodation_district,
          },
          edit_token: data.edit_token,
        }
      }), 800)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-image-page" style={{
      minHeight: '100vh',
      background: bgUrl ? `url('${bgUrl}') center/cover no-repeat fixed` : undefined,
    }}>
      <div className="bg-image-overlay" />
      <section className="section" style={{ paddingTop: '4rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="container" style={{ maxWidth: '77.78%', padding: 0 }}>
          <div className="form-card" style={{ backdropFilter: 'blur(20px)', background: 'var(--bg-card)' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>✨ 创建你的行程</h1>
            <p style={{ textAlign: 'center', color: 'var(--text-light)', marginBottom: '1.5rem' }}>告诉我们你的旅行想法，AI 为你量身定制完美行程</p>
            {error && <div className="msg msg-error">{error}</div>}
            {success && <div className="msg msg-success">{success}</div>}

            <form onSubmit={handleSubmit}>
              {/* 目的地 */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">🌍 目的地</label>
                <input
                  type="text"
                  value={formData.destination}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, destination: e.target.value }))
                    setShowDropdown(true)
                    setHighlightIndex(-1)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  onKeyDown={(e) => {
                    if (!showDropdown || filteredCities.length === 0) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setHighlightIndex(i => Math.min(i + 1, filteredCities.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setHighlightIndex(i => Math.max(i - 1, 0))
                    } else if (e.key === 'Enter' && highlightIndex >= 0) {
                      e.preventDefault()
                      setFormData(prev => ({ ...prev, destination: filteredCities[highlightIndex] }))
                      setShowDropdown(false)
                    } else if (e.key === 'Escape') {
                      setShowDropdown(false)
                    }
                  }}
                  className="form-input"
                  placeholder="比如：北京、东京、巴黎..."
                  required
                  autoComplete="off"
                />
                {showDropdown && filteredCities.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 100,
                    background: 'var(--bg-card-solid, #fff)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-md)',
                    maxHeight: '240px',
                    overflowY: 'auto',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  }}>
                    {filteredCities.map((city, i) => (
                      <div
                        key={city}
                        onMouseDown={() => {
                          setFormData(prev => ({ ...prev, destination: city }))
                          setShowDropdown(false)
                        }}
                        onMouseEnter={() => setHighlightIndex(i)}
                        style={{
                          padding: '0.6rem 1rem',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          background: i === highlightIndex ? 'rgba(14,165,233,0.1)' : 'transparent',
                          color: i === highlightIndex ? 'var(--primary-dark)' : 'inherit',
                          fontWeight: i === highlightIndex ? 600 : 400,
                        }}
                      >
                        📍 {city}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 日期选择 */}
              <div className="form-group">
                <label className="form-label">📅 旅行日期</label>
                <div className="date-picker-row">
                  <div className="date-picker-col">
                    <input
                      type="date"
                      value={formData.start_date}
                      min={today}
                      onChange={(e) => {
                        const sd = e.target.value
                        setFormData(prev => {
                          const next = { ...prev, start_date: sd }
                          if (prev.end_date && prev.end_date < sd) next.end_date = ''
                          return next
                        })
                      }}
                      className="form-input"
                      style={{ textAlign: 'center' }}
                      required
                    />
                    <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                      出发日期
                    </div>
                  </div>
                  <span className="date-picker-arrow">
                    →
                  </span>
                  <div className="date-picker-col">
                    <input
                      type="date"
                      value={formData.end_date}
                      min={formData.start_date || today}
                      max={formData.start_date ? addDays(new Date(formData.start_date), 29) : ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                      className="form-input"
                      style={{ textAlign: 'center' }}
                      required
                    />
                    <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
                      返回日期
                    </div>
                  </div>
                </div>

                {days > 0 && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.6rem 1rem',
                    background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(99,102,241,0.08))',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: 'var(--primary-dark)',
                  }}>
                    🗓️ 共 {days} 天 {days - 1} 晚
                    <span style={{ fontWeight: 400, color: 'var(--text-light)', fontSize: '0.8rem' }}>
                      （{[
                        crowdAnalysis?.weekdays > 0 && `${crowdAnalysis.weekdays}个工作日`,
                        crowdAnalysis?.weekends > 0 && `${crowdAnalysis.weekends}个周末`,
                        crowdAnalysis?.holidays > 0 && `${crowdAnalysis.holidays}天节假日`,
                      ].filter(Boolean).join(' + ')}）
                    </span>
                  </div>
                )}
              </div>

              {/* 到达/返程时间 */}
              <div className="form-group">
                  <label className="form-label">🕐 到达 / 返程时间<span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-light)' }}>（可选，不选则按完整天数排程）</span></label>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginBottom: '0.4rem' }}>第1天</div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {[
                          { value: 'morning', label: '上午到达' },
                          { value: 'afternoon', label: '下午到达' },
                        ].map(opt => (
                          <button key={opt.value} type="button"
                            className={`pace-option ${formData.arrival_time === opt.value ? 'pace-option-active' : ''}`}
                            style={{ flex: 1, padding: '0.5rem 0.6rem', fontSize: '0.82rem' }}
                            onClick={() => setFormData(prev => ({ ...prev, arrival_time: prev.arrival_time === opt.value ? '' : opt.value }))}
                          >{opt.label}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginBottom: '0.4rem' }}>最后一天</div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {[
                          { value: 'morning', label: '上午返程' },
                          { value: 'afternoon', label: '下午返程' },
                        ].map(opt => (
                          <button key={opt.value} type="button"
                            className={`pace-option ${formData.departure_time === opt.value ? 'pace-option-active' : ''}`}
                            style={{ flex: 1, padding: '0.5rem 0.6rem', fontSize: '0.82rem' }}
                            onClick={() => setFormData(prev => ({ ...prev, departure_time: prev.departure_time === opt.value ? '' : opt.value }))}
                          >{opt.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

              {/* 住宿位置 */}
              <div className="form-group">
                <label className="form-label">🏨 住宿位置（可选）</label>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginBottom: '0.5rem' }}>
                  选择你计划住宿的大致区域，AI 将以此为起点优化每天行程路线
                </div>
                {formData.accommodation_name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.4rem 0.8rem', background: 'rgba(14,165,233,0.08)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
                    <span>📍 {formData.accommodation_name}</span>
                    <button type="button" onClick={() => setFormData(prev => ({ ...prev, accommodation_lat: null, accommodation_lng: null, accommodation_name: '', accommodation_district: '' }))} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: '1.1rem' }}>✕</button>
                  </div>
                )}
                {formData.destination ? (
                  <Suspense fallback={<div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-light)' }}>加载地图...</div>}>
                    <AccommodationMap
                      destination={formData.destination}
                      value={{ lat: formData.accommodation_lat, lng: formData.accommodation_lng, name: formData.accommodation_name }}
                      onChange={(loc) => setFormData(prev => ({
                        ...prev,
                        accommodation_lat: loc.lat,
                        accommodation_lng: loc.lng,
                        accommodation_name: loc.name || '',
                        accommodation_district: loc.district || '',
                      }))}
                    />
                  </Suspense>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', padding: '1rem', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                    请先选择目的地
                  </div>
                )}
              </div>

              {/* 旅游节奏 */}
              <div className="form-group">
                <label className="form-label">🚶 旅游节奏</label>
                <div className="pace-selector">
                  {[
                    { value: 'relaxed', label: '慢游', desc: '每天2-4个活动，深度体验', icon: '🐌' },
                    { value: 'moderate', label: '经典', desc: '每天4-6个活动，平衡游览', icon: '🎒' },
                    { value: 'intensive', label: '特种兵', desc: '每天6-8个活动，效率拉满', icon: '⚡' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`pace-option ${formData.pace === opt.value ? 'pace-option-active' : ''}`}
                      onClick={() => setFormData(prev => ({ ...prev, pace: opt.value }))}
                    >
                      <span className="pace-option-icon">{opt.icon}</span>
                      <span className="pace-option-label">{opt.label}</span>
                      <span className="pace-option-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 人流分析 */}
              {crowdAnalysis && crowdAnalysis.tips.length > 0 && (
                <div className="form-group">
                  <label className="form-label">📊 人流分析</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {crowdAnalysis.tips.map((tip, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '0.65rem 1rem',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          lineHeight: 1.5,
                          background: tip.type === 'good' ? 'rgba(5,150,105,0.08)' : tip.type === 'warning' ? 'rgba(217,119,6,0.08)' : 'rgba(37,99,235,0.08)',
                          color: tip.type === 'good' ? '#059669' : tip.type === 'warning' ? '#d97706' : '#2563eb',
                          border: `1px solid ${tip.type === 'good' ? 'rgba(5,150,105,0.2)' : tip.type === 'warning' ? 'rgba(217,119,6,0.2)' : 'rgba(37,99,235,0.2)'}`,
                        }}
                      >
                        {tip.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 偏好选择 + 自定义 */}
              <div className="form-group">
                <label className="form-label">🎯 旅行偏好（可多选，支持自定义）</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {QUICK_TAGS.map(tag => {
                    const selected = formData.preferences.includes(tag.label)
                    return (
                    <button
                      key={tag.label}
                      type="button"
                      style={{
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.82rem',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid',
                        borderColor: selected ? 'var(--primary)' : 'var(--border-light)',
                        background: selected ? 'rgba(14,165,233,0.08)' : 'var(--bg-card-solid)',
                        color: selected ? 'var(--primary-dark)' : 'var(--text-secondary)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'var(--transition)',
                      }}
                      onClick={() => togglePreference(tag.label)}
                    >
                      {tag.emoji} {tag.label}
                    </button>
                  )})}

                  {/* 已添加的自定义标签 */}
                  {formData.preferences.filter(isCustomPref).map(label => (
                    <button
                      key={label}
                      type="button"
                      style={{
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.82rem',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--primary)',
                        background: 'rgba(14,165,233,0.08)',
                        color: 'var(--primary-dark)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'var(--transition)',
                      }}
                      onClick={() => removePreference(label)}
                    >
                      ✏️ {label} ✕
                    </button>
                  ))}
                </div>

                {/* 自定义输入 */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <input
                    type="text"
                    value={customPref}
                    onChange={(e) => setCustomPref(e.target.value)}
                    onKeyDown={handleCustomPrefKeyDown}
                    className="form-input"
                    placeholder="输入自定义偏好，回车添加..."
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    style={{
                      padding: '0.5rem 1rem',
                      fontSize: '0.85rem',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid var(--border-light)',
                      background: 'var(--bg-card-solid)',
                      color: 'var(--text-secondary)',
                      fontWeight: 500,
                      cursor: customPref.trim() ? 'pointer' : 'not-allowed',
                      transition: 'var(--transition)',
                      opacity: customPref.trim() ? 1 : 0.5,
                      whiteSpace: 'nowrap',
                    }}
                    onClick={addCustomPreference}
                    disabled={!customPref.trim()}
                  >
                    + 添加
                  </button>
                </div>
              </div>

              {/* 额外需求 */}
              <div className="form-group">
                <label className="form-label">📝 额外需求（便于 AI 更好地规划行程）</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {EXTRA_QUICK_TAGS.map(tag => {
                    const selected = formData.extra_tags.includes(tag.label)
                    return (
                    <button
                      key={tag.label}
                      type="button"
                      style={{
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.82rem',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid',
                        borderColor: selected ? 'var(--primary)' : 'var(--border-light)',
                        background: selected ? 'rgba(14,165,233,0.08)' : 'var(--bg-card-solid)',
                        color: selected ? 'var(--primary-dark)' : 'var(--text-secondary)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'var(--transition)',
                      }}
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          extra_tags: prev.extra_tags.includes(tag.label)
                            ? prev.extra_tags.filter(t => t !== tag.label)
                            : [...prev.extra_tags, tag.label],
                        }))
                      }}
                    >
                      {tag.emoji} {tag.label}
                    </button>
                  )})}
                </div>
                <textarea
                  value={formData.extra_requirements}
                  onChange={(e) => setFormData(prev => ({ ...prev, extra_requirements: e.target.value }))}
                  className="form-input"
                  placeholder="描述你的额外需求，例如：有老人需要少走路、有3岁小孩需要午休时间、行动不便需要无障碍设施..."
                  rows={3}
                  style={{ resize: 'vertical', minHeight: '80px' }}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.3rem' }}>
                  AI 将根据你的需求调整行程节奏、景点选择和活动安排
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={loading || !formData.destination || !formData.start_date || !formData.end_date}
                style={{ width: '100%', marginTop: '0.5rem' }}
              >
                {loading ? '⏳ 创建中...' : '🚀 开始规划行程'}
              </button>
            </form>
          </div>
        </div>
      </section>

      <footer className="footer" style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(10px)' }}>
        <div className="container">TripAI — AI 驱动的旅行规划助手</div>
      </footer>
    </div>
  )
}

export default CreatePlan

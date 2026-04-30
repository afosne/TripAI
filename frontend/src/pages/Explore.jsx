import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { isCoord, resolveLocation } from '../utils/location'
import { getFirstActivityName } from '../utils/plan'
import { POPULAR_CITIES } from '../utils/constants'

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&q=80'

function Explore() {
  const [plans, setPlans] = useState([])
  const [coverImages, setCoverImages] = useState({})
  const [resolvedCities, setResolvedCities] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState({ city: '', min_rating: '', sort: 'rating' })
  const [showCityDropdown, setShowCityDropdown] = useState(false)
  const [cityHighlight, setCityHighlight] = useState(-1)
  const cityInputRef = useRef(null)

  const filteredCities = useMemo(() => {
    const q = filter.city.trim().toLowerCase()
    const allCities = [...POPULAR_CITIES]
    if (!q) return allCities.slice(0, 20)
    return allCities.filter(c => c.toLowerCase().includes(q)).slice(0, 20)
  }, [filter.city])

  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true)
      try {
        const qp = new URLSearchParams()
        if (filter.city) qp.append('city', filter.city)
        if (filter.min_rating) qp.append('min_rating', filter.min_rating)
        if (filter.sort) qp.append('sort', filter.sort)
        const response = await fetch(`/api/plans/public?${qp.toString()}`)
        if (!response.ok) throw new Error('获取公开方案失败')
        const data = await response.json()
        setPlans(data.plans)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchPlans()
  }, [filter])

  // 解析坐标形式的城市名
  useEffect(() => {
    const coordPlans = plans.filter(p => isCoord(p.city))
    if (coordPlans.length === 0) return
    const tasks = coordPlans.map(async p => {
      const name = await resolveLocation(p.city)
      return [p.id, name]
    })
    Promise.all(tasks).then(entries => {
      const map = Object.fromEntries(entries.filter(([, v]) => v))
      setResolvedCities(prev => ({ ...prev, ...map }))
    })
  }, [plans])

  useEffect(() => {
    if (plans.length === 0) return
    const loadImages = async () => {
      const cacheRaw = localStorage.getItem('activity_images_cache')
      const cache = cacheRaw ? JSON.parse(cacheRaw) : {}
      const now = Date.now()
      const initial = {}
      for (const plan of plans) {
        const name = getFirstActivityName(plan)
        if (!name) continue
        const entry = cache[name]
        if (entry?.ts && now - entry.ts < 30 * 24 * 60 * 60 * 1000 && entry.url) {
          initial[plan.id] = entry.url
        }
      }
      if (Object.keys(initial).length > 0) {
        setCoverImages(initial)
      }

      for (const plan of plans) {
        if (initial[plan.id]) continue
        const name = getFirstActivityName(plan)
        if (!name) continue
        fetch(`/api/attraction/image?name=${encodeURIComponent(name)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.url) {
              setCoverImages(prev => ({ ...prev, [plan.id]: data.url }))
            }
          })
          .catch(() => {})
      }
    }
    loadImages()
  }, [plans])

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setFilter(prev => ({ ...prev, [name]: value }))
  }

  const parseParams = (paramsStr) => {
    try {
      return JSON.parse(paramsStr)
    } catch {
      return {}
    }
  }

  return (
    <div>
      <section className="page-banner">
        <div
          className="page-banner-bg"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1920&q=80')`,
          }}
        />
        <div className="container page-banner-content">
          <h1 className="page-banner-title">🌍 发现精彩行程</h1>
          <p className="page-banner-desc">探索旅行者们分享的优质行程方案</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="filter-bar">
            <div className="form-group" style={{ position: 'relative' }}>
              <label className="form-label">目的地</label>
              <input
                type="text"
                name="city"
                value={filter.city}
                ref={cityInputRef}
                onChange={(e) => {
                  setFilter(prev => ({ ...prev, city: e.target.value }))
                  setShowCityDropdown(true)
                  setCityHighlight(-1)
                }}
                onFocus={() => setShowCityDropdown(true)}
                onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
                onKeyDown={(e) => {
                  if (!showCityDropdown || filteredCities.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setCityHighlight(i => Math.min(i + 1, filteredCities.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setCityHighlight(i => Math.max(i - 1, 0))
                  } else if (e.key === 'Enter' && cityHighlight >= 0) {
                    e.preventDefault()
                    setFilter(prev => ({ ...prev, city: filteredCities[cityHighlight] }))
                    setShowCityDropdown(false)
                  } else if (e.key === 'Escape') {
                    setShowCityDropdown(false)
                  }
                }}
                className="form-input"
                placeholder="输入城市..."
                autoComplete="off"
              />
              {showCityDropdown && filteredCities.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: 'var(--bg-card-solid, #fff)', border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-md)', maxHeight: '240px', overflowY: 'auto',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                }}>
                  {filteredCities.map((city, i) => (
                    <div
                      key={city}
                      onMouseDown={() => {
                        setFilter(prev => ({ ...prev, city }))
                        setShowCityDropdown(false)
                      }}
                      onMouseEnter={() => setCityHighlight(i)}
                      style={{
                        padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.88rem',
                        background: i === cityHighlight ? 'rgba(14,165,233,0.1)' : 'transparent',
                        color: i === cityHighlight ? 'var(--primary-dark)' : 'inherit',
                        fontWeight: i === cityHighlight ? 600 : 400,
                      }}
                    >
                      📍 {city}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">最低评分</label>
              <select name="min_rating" value={filter.min_rating} onChange={handleFilterChange} className="form-input">
                <option value="">全部</option>
                <option value="3">3星及以上</option>
                <option value="4">4星及以上</option>
                <option value="4.5">4.5星及以上</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">排序</label>
              <select name="sort" value={filter.sort} onChange={handleFilterChange} className="form-input">
                <option value="rating">评分推荐</option>
                <option value="newest">最新发布</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="loading-wrapper">
              <div className="loading-spinner" />
              <div className="loading-text">搜索中...</div>
            </div>
          ) : error ? (
            <div className="msg msg-error">{error}</div>
          ) : plans.length > 0 ? (
            <div className="plans-grid">
              {plans.map((plan, i) => {
                const params = parseParams(plan.params)
                const startDate = params.start_date
                const endDate = params.end_date
                const preferences = params.preferences || []
                const itinerary = (() => {
                  try { return JSON.parse(plan.itinerary) } catch { return {} }
                })()
                const activityCount = itinerary?.days?.reduce(
                  (sum, d) => sum + (d.activities?.length || 0), 0
                ) || 0
                const displayTitle = itinerary?.title || plan.title

                return (
                  <Link to={`/plan/${plan.id}`} key={plan.id} className="plan-card">
                    <div className="plan-card-cover">
                      <img src={coverImages[plan.id] || FALLBACK_IMAGE} alt={plan.city} loading="lazy" />
                      <div className="plan-card-cover-overlay" />
                      <div className="plan-card-cover-city">📍 {isCoord(plan.city) ? (resolvedCities[plan.id] || '加载中...') : plan.city}</div>
                      <div className="plan-card-cover-rating">⭐ {plan.avg_rating ? plan.avg_rating.toFixed(1) : '—'}</div>
                    </div>
                    <div className="plan-card-body">
                      <h3 className="plan-card-title">{displayTitle}</h3>
                      <div className="plan-card-meta">
                        {startDate && endDate ? (
                          <span>🗓️ {startDate.slice(5)}~{endDate.slice(5)}</span>
                        ) : null}
                        {activityCount > 0 && (
                          <span>🎯 {activityCount}个活动</span>
                        )}
                        <span>💬 {plan.rating_count || 0} 评价</span>
                      </div>
                      {preferences.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
                          {preferences.slice(0, 4).map((pref, pi) => (
                            <span key={pi} className="pref-tag">{pref}</span>
                          ))}
                          {preferences.length > 4 && <span className="pref-tag">+{preferences.length - 4}</span>}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">暂无符合条件的行程</div>
              <div className="empty-state-desc">尝试调整筛选条件，或创建一个新行程</div>
              <Link to="/create" className="btn btn-primary">创建行程</Link>
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

export default Explore

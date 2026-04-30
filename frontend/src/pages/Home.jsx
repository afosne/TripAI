import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isCoord, resolveLocation } from '../utils/location'
import { getFirstActivityName } from '../utils/plan'

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&q=80'

function Home() {
  const [featuredPlans, setFeaturedPlans] = useState([])
  const [coverImages, setCoverImages] = useState({})
  const [resolvedCities, setResolvedCities] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchFeaturedPlans = async () => {
      try {
        const response = await fetch('/api/plans/public?sort=rating&limit=8')
        if (!response.ok) throw new Error('获取精选方案失败')
        const data = await response.json()
        setFeaturedPlans(data.plans)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchFeaturedPlans()
  }, [])

  // 解析坐标形式的城市名
  useEffect(() => {
    const coordPlans = featuredPlans.filter(p => isCoord(p.city))
    if (coordPlans.length === 0) return
    const tasks = coordPlans.map(async p => {
      const name = await resolveLocation(p.city)
      return [p.id, name]
    })
    Promise.all(tasks).then(entries => {
      const map = Object.fromEntries(entries.filter(([, v]) => v))
      setResolvedCities(prev => ({ ...prev, ...map }))
    })
  }, [featuredPlans])

  useEffect(() => {
    if (featuredPlans.length === 0) return
    const loadImages = async () => {
      // 先从 localStorage 缓存读取
      const cacheRaw = localStorage.getItem('activity_images_cache')
      const cache = cacheRaw ? JSON.parse(cacheRaw) : {}
      const now = Date.now()
      const initial = {}
      for (const plan of featuredPlans) {
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

      // 对没有缓存的 plan 异步获取图片
      for (const plan of featuredPlans) {
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
  }, [featuredPlans])

  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-content">
          <h1 className="hero-title">
            让每一次旅行<br /><span>都值得期待</span>
          </h1>
          <p className="hero-subtitle">
            告诉我们你的目的地和偏好，AI 为你量身定制完美行程。<br />
            景点、美食、交通，一键搞定。
          </p>
          <div className="hero-actions">
            <Link to="/create" className="btn btn-primary btn-lg">
              ✨ 免费创建行程
            </Link>
            <Link to="/explore" className="btn btn-ghost btn-lg">
              浏览热门方案 →
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section">
        <div className="container">
          <div className="features-row">
            <div className="feature-item">
              <div className="feature-icon">🤖</div>
              <div className="feature-title">AI 智能规划</div>
              <div className="feature-desc">根据你的偏好，自动生成个性化行程</div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🗺️</div>
              <div className="feature-title">地图导航</div>
              <div className="feature-desc">集成高德地图，实时路线和交通信息</div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🌤️</div>
              <div className="feature-title">天气分析</div>
              <div className="feature-desc">实时天气预报，雨天自动推荐室内景点</div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📸</div>
              <div className="feature-title">景点图册</div>
              <div className="feature-desc">精美景点图片，提前感受目的地魅力</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Plans */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-header">
            <div className="section-label">🔥 精选推荐</div>
            <h2 className="section-title">热门旅行方案</h2>
            <p className="section-subtitle">由旅行爱好者们评价选出的优质行程</p>
          </div>

          {loading ? (
            <div className="loading-wrapper">
              <div className="loading-spinner" />
              <div className="loading-text">加载中...</div>
            </div>
          ) : error ? (
            <div className="msg msg-error">{error}</div>
          ) : featuredPlans.length > 0 ? (
            <div className="plans-grid">
              {featuredPlans.map((plan, i) => {
                const p = (() => { try { return JSON.parse(plan.params) } catch { return {} } })()
                const prefs = p.preferences || []
                const itinerary = (() => { try { return JSON.parse(plan.itinerary) } catch { return {} } })()
                const displayTitle = itinerary?.title || plan.title
                return (
                  <Link to={`/plan/${plan.id}`} key={plan.id} className="plan-card">
                    <div className="plan-card-cover">
                      <img
                        src={coverImages[plan.id] || FALLBACK_IMAGE}
                        alt={plan.city}
                        loading="lazy"
                      />
                      <div className="plan-card-cover-overlay" />
                      <div className="plan-card-cover-city">📍 {isCoord(plan.city) ? (resolvedCities[plan.id] || '加载中...') : plan.city}</div>
                      <div className="plan-card-cover-rating">
                        ⭐ {plan.avg_rating ? plan.avg_rating.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div className="plan-card-body">
                      <h3 className="plan-card-title">{displayTitle}</h3>
                      <div className="plan-card-meta">
                        {p.start_date && p.end_date ? (
                          <span>🗓️ {p.start_date.slice(5)}~{p.end_date.slice(5)}</span>
                        ) : null}
                        <span>💬 {plan.rating_count || 0} 评价</span>
                      </div>
                      {prefs.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
                          {prefs.slice(0, 4).map((pref, pi) => (
                            <span key={pi} className="pref-tag">{pref}</span>
                          ))}
                          {prefs.length > 4 && <span className="pref-tag">+{prefs.length - 4}</span>}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">✈️</div>
              <div className="empty-state-title">暂无精选行程</div>
              <div className="empty-state-desc">快来创建第一个行程吧！</div>
              <Link to="/create" className="btn btn-primary">创建行程</Link>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          TripAI — AI 驱动的旅行规划助手 · AFOSNE
        </div>
      </footer>
    </div>
  )
}

export default Home

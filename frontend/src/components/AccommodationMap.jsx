import { useState, useEffect, useRef } from 'react'
import { loadAmap } from '../utils/amap'

export default function AccommodationMap({ destination, value, onChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const geocoderRef = useRef(null)
  const [searchText, setSearchText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loaded, setLoaded] = useState(false)
  const searchTimer = useRef(null)

  // Initialize map
  useEffect(() => {
    let destroyed = false
    loadAmap().then(AMap => {
      if (destroyed || !containerRef.current) return

      const map = new AMap.Map(containerRef.current, {
        zoom: 12,
        resizeEnable: true,
      })
      mapRef.current = map
      geocoderRef.current = new AMap.Geocoder()
      setLoaded(true)

      // If we have a saved position, place marker
      if (value?.lat && value?.lng) {
        const pos = new AMap.LngLat(value.lng, value.lat)
        map.setCenter(pos)
        placeMarker(AMap, pos)
      }

      // Click to select
      map.on('click', (e) => {
        const lnglat = e.lnglat
        placeMarker(AMap, lnglat)
        reverseGeocode(lnglat)
      })

      // Geocode destination to center map
      if (!value?.lat) {
        geocoderRef.current.getLocation(destination, (status, result) => {
          if (status === 'complete' && result.geocodes?.[0]) {
            const center = result.geocodes[0].location
            map.setCenter([center.lng, center.lat])
          }
        })
      }
    }).catch(() => {})

    return () => {
      destroyed = true
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
      }
    }
  }, [destination])

  function placeMarker(AMap, lnglat) {
    if (!mapRef.current) return
    if (markerRef.current) mapRef.current.remove(markerRef.current)
    const marker = new AMap.Marker({
      position: lnglat,
      draggable: true,
      animation: 'AMAP_ANIMATION_DROP',
    })
    marker.on('dragend', () => {
      const pos = marker.getPosition()
      reverseGeocode(pos)
    })
    mapRef.current.add(marker)
    markerRef.current = marker
  }

  function reverseGeocode(lnglat) {
    if (!geocoderRef.current) return
    geocoderRef.current.getAddress(lnglat, (status, result) => {
      if (status === 'complete' && result.regeocode) {
        const addr = result.regeocode
        const district = addr.addressComponent?.district || addr.addressComponent?.city || ''
        const name = addr.formattedAddress || `${lnglat.lat.toFixed(4)}, ${lnglat.lng.toFixed(4)}`
        onChange({ lat: lnglat.lat, lng: lnglat.lng, name, district })
      }
    })
  }

  function handleSearch(text) {
    setSearchText(text)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!text.trim()) { setSuggestions([]); return }
    searchTimer.current = setTimeout(() => {
      fetch(`/api/geocode/suggest?keywords=${encodeURIComponent(text + ' ' + destination)}`)
        .then(r => r.json())
        .then(d => setSuggestions(d.tips || []))
        .catch(() => setSuggestions([]))
    }, 300)
  }

  function selectSuggestion(tip) {
    setSearchText('')
    setSuggestions([])
    if (!mapRef.current) return
    const AMap = window.AMap
    const lnglat = new AMap.LngLat(tip.lng, tip.lat)
    mapRef.current.setCenter(lnglat)
    mapRef.current.setZoom(14)
    placeMarker(AMap, lnglat)
    onChange({ lat: tip.lat, lng: tip.lng, name: tip.name, district: tip.district || '' })
  }

  return (
    <div>
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={searchText}
          onChange={e => handleSearch(e.target.value)}
          placeholder="搜索地点或区域..."
          style={{
            width: '100%', padding: '0.55rem 0.8rem', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
            color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', maxHeight: 200, overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {suggestions.map((tip, i) => (
              <div key={i} onClick={() => selectSuggestion(tip)} style={{
                padding: '0.5rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}
                onMouseEnter={e => e.target.style.background = 'var(--bg-secondary)'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                <div style={{ fontWeight: 500 }}>{tip.name}</div>
                {tip.address && <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{tip.district} {tip.address}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div
        ref={containerRef}
        style={{
          width: '100%', height: 300, borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)', overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}
      />
      <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.3rem' }}>
        点击地图或搜索选择住宿大致位置，可拖拽标记微调
      </div>
    </div>
  )
}

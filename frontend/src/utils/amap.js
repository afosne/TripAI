let amapLoading = null

export async function loadAmap() {
  if (window.AMap) return window.AMap
  if (amapLoading) return amapLoading

  amapLoading = new Promise((resolve, reject) => {
    fetch('/api/map/config')
      .then(r => r.json())
      .then(({ key, jscode }) => {
        if (!key) { reject(new Error('Amap key not configured')); return }

        window._AMapSecurityConfig = { securityJsCode: jscode }

        const script = document.createElement('script')
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Geocoder,AMap.PlaceSearch,AMap.AutoComplete`
        script.onload = () => resolve(window.AMap)
        script.onerror = () => reject(new Error('Failed to load Amap SDK'))
        document.head.appendChild(script)
      })
      .catch(reject)
  })

  return amapLoading
}

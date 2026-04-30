export class AmapService {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async geocode(address: string, city?: string) {
    const url = `https://restapi.amap.com/v3/geocode/geo?` +
      `address=${encodeURIComponent(address)}` +
      (city ? `&city=${encodeURIComponent(city)}` : '') +
      `&key=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`高德地理编码失败: ${response.statusText}`)
    const data = await response.json() as any

    if (data.geocodes?.length > 0) {
      const geo = data.geocodes[0]
      const [lng, lat] = (geo.location || '').split(',').map(Number)
      return {
        formatted_address: geo.formatted_address || '',
        location: geo.location || '',
        lng,
        lat,
        adcode: geo.adcode || '',
        name: geo.formatted_address || address,
      }
    }
    return null
  }

  async getPoiByName(name: string, city?: string) {
    const url = `https://restapi.amap.com/v3/place/text?` +
      `keywords=${encodeURIComponent(name)}` +
      (city ? `&city=${encodeURIComponent(city)}` : '') +
      `&key=${this.apiKey}` +
      `&offset=1&output=json`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`高德POI搜索失败: ${response.statusText}`)
    const data = await response.json() as any

    if (data.pois?.length > 0) {
      const poi = data.pois[0]
      const [lng, lat] = (poi.location || '').split(',').map(Number)
      return {
        id: poi.id || '',
        name: poi.name || name,
        address: poi.address || '',
        location: poi.location || '',
        lng,
        lat,
        pname: poi.pname || '',
        cityname: poi.cityname || '',
        adname: poi.adname || '',
      }
    }
    return null
  }

  async getDirection(origin: string, destination: string, mode: 'driving' | 'walking' | 'transit' = 'driving') {
    const url = `https://restapi.amap.com/v3/direction/${mode}?` +
      `origin=${encodeURIComponent(origin)}&` +
      `destination=${encodeURIComponent(destination)}&` +
      `key=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`高德地图 API 调用失败: ${response.statusText}`)
    }

    return response.json()
  }

  // 周边搜索
  async getAround(location: string, keywords: string, radius: number = 1000) {
    const url = `https://restapi.amap.com/v3/place/around?` +
      `location=${encodeURIComponent(location)}&` +
      `keywords=${encodeURIComponent(keywords)}&` +
      `radius=${radius}&` +
      `key=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`高德地图 API 调用失败: ${response.statusText}`)
    }

    return response.json()
  }

  async getWeather(city: string) {
    const url = `https://restapi.amap.com/v3/weather/weatherInfo?city=${encodeURIComponent(city)}&key=${this.apiKey}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`高德天气失败: ${response.statusText}`)
    return response.json()
  }

  async getWeatherForecast(city: string) {
    const url = `https://restapi.amap.com/v3/weather/weatherInfo?city=${encodeURIComponent(city)}&key=${this.apiKey}&extensions=all`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`高德天气预报失败: ${response.statusText}`)
    return response.json()
  }

  async getWeatherWithForecasts(city: string) {
    const [liveData, forecastsData] = await Promise.all([
      this.getWeather(city),
      this.getWeatherForecast(city),
    ]) as [any, any]

    const result: { live: any | null; forecasts: any[] } = { live: null, forecasts: [] }

    if (liveData.status === '1' && liveData.lives?.[0]) {
      const l = liveData.lives[0]
      result.live = {
        temperature: l.temperature || '--',
        humidity: l.humidity || '--',
        weather: l.weather || '未知',
        winddirection: l.winddirection || '--',
        windpower: l.windpower || '--',
      }
    }

    if (forecastsData.status === '1' && forecastsData.forecasts?.[0]) {
      const fc = forecastsData.forecasts[0]
      if (fc.casts) {
        result.forecasts = fc.casts.map((c: any) => ({
          date: c.date, dayweather: c.dayweather, nightweather: c.nightweather,
          daytemp: c.daytemp, nighttemp: c.nighttemp,
        }))
      }
    }

    return result
  }

  // POI 详情
  async getPoiDetail(id: string) {
    const url = `https://restapi.amap.com/v3/place/detail?` +
      `id=${encodeURIComponent(id)}&` +
      `key=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`高德地图 API 调用失败: ${response.statusText}`)
    }

    return response.json()
  }

  // 实时路况
  async getTraffic(status: string, extensions: 'base' | 'all' = 'base') {
    const url = `https://restapi.amap.com/v3/traffic/status?` +
      `key=${this.apiKey}&` +
      `extensions=${extensions}&` +
      `level=1&` +
      `status=${status}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`高德地图 API 调用失败: ${response.statusText}`)
    }

    return response.json()
  }

  async regeocode(lng: number, lat: number) {
    const url = `https://restapi.amap.com/v3/geocode/regeo?` +
      `location=${lng},${lat}&` +
      `key=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`反向地理编码失败: ${response.statusText}`)
    const data = await response.json() as any

    if (data.regeocode) {
      const comp = data.regeocode.addressComponent || {}
      return {
        formatted_address: data.regeocode.formatted_address || '',
        province: comp.province || '',
        city: (Array.isArray(comp.city) ? '' : comp.city) || comp.province || '',
        district: comp.district || '',
      }
    }
    return null
  }

  async inputtips(keywords: string, location?: string) {
    // 用 place/text 代替 inputtips，支持 location 按距离排序
    let url = `https://restapi.amap.com/v3/place/text?` +
      `key=${this.apiKey}&` +
      `keywords=${encodeURIComponent(keywords)}` +
      `&offset=10&output=json`
    if (location) {
      url += `&location=${encodeURIComponent(location)}`
    }

    const response = await fetch(url)
    if (!response.ok) throw new Error(`输入提示失败: ${response.statusText}`)
    const data = await response.json() as any

    return (data.pois || []).map((poi: any) => {
      const [lng, lat] = (poi.location || '').split(',').map(Number)
      return {
        name: poi.name || '',
        address: poi.address || '',
        district: (poi.pname || '') + (poi.cityname || '') + (poi.adname || ''),
        lng,
        lat,
      }
    })
  }
}

export interface CloudflareBindings {
  DB: D1Database
  CACHE: KVNamespace
  ASSETS: Fetcher
  AI_API_KEY: string
  AI_BASE_URL: string
  AI_MODEL: string
  AMAP_API_KEY: string
  AMAP_JS_KEY?: string
  AMAP_JSCODE?: string
  UNSPLASH_ACCESS_KEY: string
  AI_GATEWAY_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  AI_GATEWAY_TOKEN?: string
  AI_FALLBACK_MODEL?: string
  AI_QUEUE?: Queue
  AI_MODE?: string
}

export interface Plan {
  id: string
  user_id: string
  title: string
  params: string
  itinerary: string
  version: number
  is_public: boolean
  avg_rating: number
  rating_count: number
  city: string
  created_at: number
}

export interface Review {
  id: string
  plan_id: string
  user_id: string
  nickname: string
  email: string
  rating: number
  comment: string
}

export interface Day {
  day: number
  activities: Activity[]
}

export interface Activity {
  name: string
  description: string
  location: string
  duration: number
  time: string
  cover_image?: string
  address?: string
  rating?: number
}

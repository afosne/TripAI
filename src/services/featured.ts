export class FeaturedService {
  private cache: KVNamespace

  constructor(cache: KVNamespace) {
    this.cache = cache
  }

  // 计算并更新精选方案
  async updateFeaturedPlans(db: D1Database) {
    try {
      console.log('开始计算精选方案...')

      // 按城市分组获取方案
      const cities = await this.getCitiesWithPlans(db)
      const featuredPlans: any[] = []

      // 每个城市最多取 3 个方案，保证多样性
      const plansPerCity = 3

      for (const city of cities) {
        const cityPlans = await this.getTopPlansByCity(db, city.city as string, plansPerCity)
        featuredPlans.push(...cityPlans)

        // 如果已经收集了足够的方案，停止
        if (featuredPlans.length >= 20) {
          break
        }
      }

      // 如果方案不足 20 个，再从所有方案中补充
      if (featuredPlans.length < 20) {
        const remainingCount = 20 - featuredPlans.length
        const additionalPlans = await this.getTopPlans(db, remainingCount, featuredPlans.map(p => p.id))
        featuredPlans.push(...additionalPlans)
      }

      // 截取前 20 个
      const finalPlans = featuredPlans.slice(0, 20)

      // 存入 KV（缓存 6 小时）
      await this.cache.put('featured_plans', JSON.stringify(finalPlans), {
        expirationTtl: 90 * 24 * 60 * 60
      })

      console.log(`精选方案更新完成，共 ${finalPlans.length} 个方案`)
      return finalPlans
    } catch (error) {
      console.error('更新精选方案失败:', error)
      throw error
    }
  }

  // 获取有方案的城市列表
  private async getCitiesWithPlans(db: D1Database) {
    const result = await db.prepare(`
      SELECT city, COUNT(*) as plan_count
      FROM plans
      WHERE is_public = 1
      GROUP BY city
      ORDER BY plan_count DESC
    `).all()

    return result.results || []
  }

  // 按城市获取 Top N 方案
  private async getTopPlansByCity(db: D1Database, city: string, limit: number) {
    const result = await db.prepare(`
      SELECT * FROM plans
      WHERE is_public = 1 AND city = ?
      ORDER BY avg_rating * log(rating_count + 1) DESC
      LIMIT ?
    `).bind(city, limit).all()

    return result.results || []
  }

  // 获取 Top N 方案（排除指定 ID）
  private async getTopPlans(db: D1Database, limit: number, excludeIds: string[]) {
    let query = `
      SELECT * FROM plans
      WHERE is_public = 1
    `

    const params: any[] = []

    if (excludeIds.length > 0) {
      query += ' AND id NOT IN (' + excludeIds.map(() => '?').join(',') + ')'
      params.push(...excludeIds)
    }

    query += ' ORDER BY avg_rating * log(rating_count + 1) DESC LIMIT ?'
    params.push(limit)

    const result = await db.prepare(query).bind(...params).all()
    return result.results || []
  }

  // 获取精选方案（从缓存）
  async getFeaturedPlans() {
    try {
      const cachedData = await this.cache.get('featured_plans')
      if (cachedData) {
        return JSON.parse(cachedData)
      }
      return []
    } catch (error) {
      console.error('获取精选方案失败:', error)
      return []
    }
  }
}

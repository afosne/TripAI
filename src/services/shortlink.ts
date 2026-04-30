export class ShortlinkService {
  private cache: KVNamespace

  constructor(cache: KVNamespace) {
    this.cache = cache
  }

  // 生成短链接
  async generateShortlink(planId: string): Promise<string> {
    // 生成短码（6位随机字符）
    const shortCode = this.generateShortCode(6)
    const shortId = shortCode

    // 存储映射关系（缓存 30 天）
    await this.cache.put(`shortlink:${shortId}`, planId, {
      expirationTtl: 90 * 24 * 60 * 60
    })

    return shortId
  }

  // 解析短链接
  async resolveShortlink(shortId: string): Promise<string | null> {
    const planId = await this.cache.get(`shortlink:${shortId}`)
    return planId
  }

  // 生成随机短码
  private generateShortCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}

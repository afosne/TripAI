

export async function initDatabase(db: D1Database) {
  await db.exec('CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, params TEXT, itinerary TEXT, version INT, is_public INT DEFAULT 1, avg_rating REAL DEFAULT 0, rating_count INT DEFAULT 0, city TEXT, created_at INT)')
  await db.exec('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, plan_id TEXT, user_id TEXT, nickname TEXT, email TEXT, rating INT, comment TEXT, FOREIGN KEY (plan_id) REFERENCES plans(id))')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_plans_city ON plans(city)')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_plans_public ON plans(is_public)')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at)')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_plan_id ON reviews(plan_id)')

  // 迁移：为已有 reviews 表补充 nickname/email 列
  try { await db.exec('ALTER TABLE reviews ADD COLUMN nickname TEXT') } catch {}
  try { await db.exec('ALTER TABLE reviews ADD COLUMN email TEXT') } catch {}

  // 迁移：为 plans 表添加 edit_token 列
  try { await db.exec('ALTER TABLE plans ADD COLUMN edit_token TEXT') } catch {}

  // 迁移：为 plans 表添加 status 列（替代 itinerary NOT LIKE 查询）
  try { await db.exec('ALTER TABLE plans ADD COLUMN status TEXT') } catch {}
  try { await db.exec('CREATE INDEX IF NOT EXISTS idx_plans_public_status ON plans(is_public, status)') } catch {}
}

export async function getPlan(db: D1Database, id: string) {
  const result = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first()
  return result
}

export async function createPlan(db: D1Database, plan: any) {
  const result = await db.prepare(`
    INSERT INTO plans (id, user_id, title, params, itinerary, version, is_public, avg_rating, rating_count, city, created_at, edit_token, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    plan.id,
    plan.user_id,
    plan.title,
    plan.params,
    plan.itinerary,
    plan.version,
    plan.is_public ? 1 : 0,
    plan.avg_rating || 0,
    plan.rating_count || 0,
    plan.city,
    plan.created_at,
    plan.edit_token || null,
    plan.status || 'pending'
  ).run()
  return result
}

// 使用乐观锁更新行程
export async function updatePlanWithOptimisticLock(db: D1Database, id: string, updates: any, currentVersion: number) {
  let query = 'UPDATE plans SET itinerary = ?, version = ?'
  const params: any[] = [updates.itinerary, updates.version]

  if (updates.is_public !== undefined) {
    query += ', is_public = ?'
    params.push(updates.is_public)
  }

  if (updates.title !== undefined) {
    query += ', title = ?'
    params.push(updates.title)
  }

  if (updates.status !== undefined) {
    query += ', status = ?'
    params.push(updates.status)
  }

  query += ' WHERE id = ? AND version = ?'
  params.push(id, currentVersion)

  return await db.prepare(query).bind(...params).run()
}

export async function createReview(db: D1Database, review: any) {
  const result = await db.prepare(`
    INSERT INTO reviews (id, plan_id, user_id, nickname, email, rating, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    review.id,
    review.plan_id,
    review.user_id,
    review.nickname || '',
    review.email || '',
    review.rating,
    review.comment
  ).run()
  return result
}

export async function getReviews(db: D1Database, planId: string) {
  const result = await db.prepare('SELECT * FROM reviews WHERE plan_id = ?').bind(planId).all()
  return result
}

export async function updatePlanRating(db: D1Database, planId: string) {
  const result = await db.prepare(`
    UPDATE plans
    SET avg_rating = (SELECT AVG(rating) FROM reviews WHERE plan_id = ?),
        rating_count = (SELECT COUNT(*) FROM reviews WHERE plan_id = ?)
    WHERE id = ?
  `).bind(planId, planId, planId).run()
  return result
}

// 检查用户是否已经评价过
export async function hasUserReviewed(db: D1Database, planId: string, userId: string) {
  const result = await db.prepare('SELECT id FROM reviews WHERE plan_id = ? AND user_id = ?').bind(planId, userId).first()
  return result !== null
}

export async function getFeaturedPlans(db: D1Database, limit: number = 20) {
  const result = await db.prepare('SELECT * FROM plans WHERE is_public = 1 AND (status IS NULL OR status = ?) ORDER BY COALESCE(avg_rating, 0) DESC, created_at DESC LIMIT ?').bind('completed', limit).all()
  return result
}

// 获取公开方案列表
export async function getPublicPlans(db: D1Database, filter: any = {}, limit: number = 20, offset: number = 0) {
  let query = 'SELECT * FROM plans WHERE is_public = 1 AND (status IS NULL OR status = ?)'
  const params: any[] = ['completed']

  // 按目的地筛选
  if (filter.city) {
    query += ' AND city = ?'
    params.push(filter.city)
  }

  // 按评分筛选
  if (filter.min_rating) {
    query += ' AND avg_rating >= ?'
    params.push(filter.min_rating)
  }

  // 排序
  if (filter.sort === 'newest') {
    query += ' ORDER BY created_at DESC'
  } else {
    query += ' ORDER BY COALESCE(avg_rating, 0) DESC, created_at DESC'
  }

  // 分页
  query += ' LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const result = await db.prepare(query).bind(...params).all()
  return result
}

// 获取方案总数
export async function getPlansCount(db: D1Database, filter: any = {}) {
  let query = 'SELECT COUNT(*) as count FROM plans WHERE is_public = 1 AND (status IS NULL OR status = ?)'
  const params: any[] = ['completed']

  // 按目的地筛选
  if (filter.city) {
    query += ' AND city = ?'
    params.push(filter.city)
  }

  // 按评分筛选
  if (filter.min_rating) {
    query += ' AND avg_rating >= ?'
    params.push(filter.min_rating)
  }

  const result = await db.prepare(query).bind(...params).first()
  return result?.count || 0
}

export async function deletePlan(db: D1Database, id: string) {
  await db.batch([
    db.prepare('DELETE FROM reviews WHERE plan_id = ?').bind(id),
    db.prepare('DELETE FROM plans WHERE id = ?').bind(id),
  ])
}

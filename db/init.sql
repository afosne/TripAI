-- 方案表
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    params TEXT,        -- JSON
    itinerary TEXT,     -- JSON 行程
    version INT,
    is_public BOOLEAN,
    avg_rating REAL,
    rating_count INT,
    city TEXT,
    created_at INT
);

-- 评价表
CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    user_id TEXT,
    nickname TEXT,
    email TEXT,
    rating INT,
    comment TEXT,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_plans_city ON plans(city);
CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_plan_id ON reviews(plan_id);

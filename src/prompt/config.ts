// ===== 行程生成统一配置 =====
// 所有 prompt 共用的分级、节奏、排程常量

// ---------- 节奏/人群配置 ----------

export const PACE_CONFIG: Record<string, {
  label: string
  mustHours: number
  activitiesPerDay: string
  durationAdj: string
  restInterval: string
  nightlife: string
  transitMin: string
  optionalPerDay: string
}> = {
  relaxed: {
    label: '慢游',
    mustHours: 4,
    activitiesPerDay: '2-4 个',
    durationAdj: '每个景点停留时间比正常多一半时间，充分体验',
    restInterval: '活动之间留 30-60 分钟休息和自由活动时间',
    nightlife: '如用户喜欢夜生活可安排夜间活动，不做强制要求',
    transitMin: '20~40',
    optionalPerDay: '0-1 个',
  },
  moderate: {
    label: '经典',
    mustHours: 6,
    activitiesPerDay: '4-6 个',
    durationAdj: '按标准游览时长安排',
    restInterval: '白天活动之间适当留出休息间隔',
    nightlife: '如果城市夜生活丰富，合理安排夜间活动',
    transitMin: '15~30',
    optionalPerDay: '1-2 个',
  },
  intensive: {
    label: '特种兵',
    mustHours: 8,
    activitiesPerDay: '6-8 个',
    durationAdj: '每个景点停留时间比正常少一半时间，紧凑高效',
    restInterval: '活动之间仅留 10-15 分钟快速转场时间',
    nightlife: '城市有夜生活则必安排夜间活动，最大化游览效率',
    transitMin: '10~15',
    optionalPerDay: '2-3 个',
  },
}

export function getPaceConfig(params: any) {
  const pace = params?.pace
  if (pace && PACE_CONFIG[pace]) return PACE_CONFIG[pace]
  return PACE_CONFIG.moderate
}

// ---------- 景点时长分级 ----------

export const DURATION_TIERS = `时长分级（以经典节奏为基准，不是硬性规定，根据实际情况灵活调整）：
- 超大型景区（迪士尼、环球影城等大型主题乐园,故宫、长城面积较大的景区,衡山、泰山等高度较高的山峰等此类需要全天游览的）：经典 240-480 分钟，慢游 +30-60 分钟，特种兵约减半（120-240 分钟，只看核心区域）
- 大型景区（西湖、颐和园等半天起步的）：经典 180-240 分钟，慢游 +30-60 分钟，特种兵约减半（90-120 分钟）
- 中小型景区（博物馆、特色街区、公园等）：经典 90-150 分钟，慢游 +30-60 分钟，特种兵约减半（45-75 分钟）
- 打卡点（网红墙、地标拍照、小型展馆等）：经典 30-60 分钟，慢游 +15-30 分钟，特种兵 15-30 分钟
用餐时长：早餐 45 分钟、午餐 60 分钟、晚餐 60 分钟`


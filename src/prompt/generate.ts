import type { ChatMessage } from '../services/openai'
import { DURATION_TIERS } from './config'

export function buildExplorePrompt(params: any, pace: any): ChatMessage {
  const prefs = params.preferences?.join('、') || '综合'
  let dateInfo = ''
  if (params.start_date && params.end_date) {
    dateInfo = `旅行时间：${params.start_date} 至 ${params.end_date}，共 ${params.days} 天\n`
  } else {
    dateInfo = `旅行天数：${params.days} 天\n`
  }
  return {
    role: 'user',
    content: `请根据以下旅行计划，介绍 ${params.destination} 作为旅游目的地的特色：

重要：如果"${params.destination}"不是地球上真实存在的城市或旅游目的地（如虚构地名、外星球、神话/动漫/游戏地点等），请在 overview 字段中明确说明"该目的地不在本服务支持范围内，本服务仅支持地球上真实城市的旅行规划"，其余字段可以简短带过。

${dateInfo}旅行偏好：${prefs}
旅游节奏：${pace.label}模式（每天安排${pace.activitiesPerDay}活动）
${params.extra_requirements ? `额外需求：${params.extra_requirements}
` : ''}
请结合旅行时间、偏好和节奏，给出有针对性的分析，包括：
- 城市概况（2-3句话，结合旅行偏好重点介绍）
- 该时间段的最佳旅游季节提示（是否适合去、需要注意什么）
- 文化特色（推荐与偏好相关的体验）
- 交通建议（针对旅行时间和节奏的实用建议）

返回 JSON 格式，字段：overview(城市概况), best_season(最佳季节提示), culture(文化特色), transport_tips(交通建议)`,
  }
}

export function buildAttractionsPrompt(params: any, pace: any, mustCount: number, mustHours: number): ChatMessage {
  const prefs = params.preferences?.join('、') || '综合'
  return {
    role: 'user',
    content: `请推荐 ${params.destination} 的 ${params.days} 天行程中的景点，考虑以下偏好：${prefs}。
旅游节奏：${pace.label}模式（每天安排${pace.activitiesPerDay}活动，${pace.durationAdj}）
${params.extra_requirements ? `额外需求：${params.extra_requirements}` : ''}

将景点分为两类：
- must（必去）：城市的核心代表景点，不来等于没来
- optional（可选）：打卡点、小众景点、特色街区等，游览时间较短

规则：
1. estimated_duration 参考以下${DURATION_TIERS}
2. must 类景点数量 ${mustCount} 个，optional 类 ${pace.mustHours >= 8 ? '5-8' : '3-6'} 个
3. must 类景点总游览时长不应超过 ${params.days * mustHours} 小时
4. 宁可少而精，不要堆砌景点

返回 JSON 格式，包含 "items" 数组，每个元素有：
- name: 景点名称
- description: 景点描述（1-2句话）
- reason: 推荐理由
- estimated_duration: 预估游览时长（分钟）
- level: "must" 或 "optional"
- area: 所在区域或商圈（如"天河区"、"西湖景区"、"老城区"）`,
  }
}

export function buildFoodPrompt(params: any): ChatMessage {
  let foodDateInfo = ''
  if (params.start_date && params.end_date) {
    foodDateInfo = `旅行时间：${params.start_date} 至 ${params.end_date}
请特别推荐该季节的时令美食和应季食材。
`
  }
  let accommodationHint = ''
  if (params.accommodation_name) {
    accommodationHint = `\n用户住宿区域：${params.accommodation_name}（${params.accommodation_district || ''}），请额外推荐该区域附近的 1-2 个早餐或宵夜选择。`
  }
  return {
    role: 'user',
    content: `请推荐 ${params.destination} 的特色美食和餐厅。

${foodDateInfo}必须包含 2-3 个当地特色早餐推荐（如早茶、特色早点、传统早餐店等）。
${accommodationHint}
推荐时要考虑景点分布：尽量推荐不同区域（热门景点附近、老城区、商业区）的美食，以便行程规划时可以根据当天景点安排就近用餐。

返回 JSON 格式，包含 "items" 数组，每个元素有：
- name: 美食/餐厅名称
- description: 描述（1-2句话，如果是时令美食请说明）
- type: 类型（如 "特色早餐"、"时令美食"、"特色小吃"、"高档餐厅"、"街边美食" 等）
- area: 所在商圈或区域（如"天河区"、"越秀公园附近"、"老城区"）

推荐 8-12 个，其中至少 2 个是特色早餐。`,
  }
}

export function buildGeneratePrompt(
  params: any,
  pace: any,
  weatherContext: string,
  exploreInfo: any,
  attractionList: string,
  foodList: string,
): ChatMessage {
  const optionalPerDay = pace.optionalPerDay
  const transitMin = pace.transitMin

  // Half-day scheduling context
  let schedulingContext = ''
  if (params.arrival_time === 'morning') {
    schedulingContext += `- 第1天：上午到达，仅安排下午和晚上的行程（从 13:00 开始，跳过早餐和上午景点）\n`
  } else if (params.arrival_time === 'afternoon') {
    schedulingContext += `- 第1天：下午到达，仅安排傍晚和夜间行程（从 16:00 开始，仅安排晚餐和夜间活动）\n`
  }
  if (params.departure_time === 'morning') {
    schedulingContext += `- 第${params.days}天：上午返程，仅安排早餐，10:00 前结束所有活动\n`
  } else if (params.departure_time === 'afternoon') {
    schedulingContext += `- 第${params.days}天：下午返程，安排到午餐后，14:00 前结束所有活动\n`
  }
  if (schedulingContext) {
    schedulingContext = `\n特殊日程安排：\n${schedulingContext}半天行程中景点数量减半，只安排该区域最精华的1-2个景点。\n`
  }

  // Accommodation routing context
  let accommodationContext = ''
  if (params.accommodation_name) {
    accommodationContext = `\n行程起点/终点：用户住宿在${params.accommodation_district ? params.accommodation_district + '的' : ''}${params.accommodation_name}附近，每天行程应从住宿区域出发并尽量返回该区域。景点按地理位置从近到远或形成环线安排，避免往返折返。`
  }

  return {
    role: 'user',
    content: `请根据以下信息，为 ${params.destination} 规划一个 ${params.days} 天的完整行程。

${weatherContext ? weatherContext + '\n' : ''}
城市特色：${exploreInfo?.overview || '无'}
旅行偏好：${params.preferences?.join('、') || '综合'}
旅游节奏：${pace.label}模式（每天安排${pace.activitiesPerDay}活动）
${params.extra_requirements ? `额外需求：${params.extra_requirements}` : ''}
${schedulingContext}${accommodationContext}

可选景点（【必去】为每天主打景点，【可选】为打卡点/小景点）：
${attractionList}

推荐美食：
${foodList}

排程规则：
1. 每天安排三餐：早餐（约 07:00-08:30，45 分钟）、午餐（约 11:30-13:00，60 分钟）、晚餐（约 17:30-19:00，60 分钟）
2. 餐食 name 格式为"餐类·城市·具体名称"（如"早餐·广州·早茶"、"午餐·北京·全聚德烤鸭"、"晚餐·成都·小龙坎火锅"）
3. 用餐时间灵活调整：大部分景区一张票只能进出一次，不能中途出来吃饭再回去。午餐和晚餐时间都应根据景点实际结束时间灵活推迟，不要为了卡用餐时间而打断游览。午餐推迟到上午景点结束后（最晚可推迟到 14:00），晚餐推迟到下午景点结束后（最晚可推迟到 19:30）。用餐地点安排在刚结束的景点附近。超大型/大型景区内一般有餐饮场所，如果全天或半天都在景区内，直接将午餐或晚餐安排在景区内，在 description 中建议"可自备简餐或在园区内用餐"，name 仍按"餐类·城市·具体名称"格式标注。特殊活动灵活处理：如北京天安门升旗仪式（凌晨 5-6 点）、南昌八一广场升旗等早起活动，早餐可以在活动之前或之后灵活安排，不要因为卡早餐时间错过体验
4. 每天以 1-2 个【必去】景点为骨架。只有超大型景区（迪士尼、故宫、环球影城等需要全天游览的）单独占一天；大型景区（长城、颐和园）占半天；中小型必去景点可以组合在同一个半天内游览（一个上午或下午逛 2-4 个）
5. 【可选】景点根据剩余时间和地理位置穿插安排，不超过每天 ${optionalPerDay}，没时间可以不加
6. duration 参考以下${DURATION_TIERS}
7. 相近区域的景点安排同一天，避免跨区奔波
8. time 字段必须严格递增，每个活动的 time = 前一个活动的 time + duration + ${transitMin}分钟交通时间，绝不允许时间冲突或倒退
9. 三餐插入行程中：早餐后去景点，上午景点结束后插午餐，下午景点结束后插晚餐。餐食活动之间必须留交通时间
10. ${pace.restInterval}
11. ${pace.nightlife}。夜间活动从 19:30-20:00 开始，持续 60-120 分钟；夜生活不突出的城市最晚活动在 19:00 前结束
12. 用餐就近原则：每天的早餐应靠近住宿区域${params.accommodation_name ? '（' + params.accommodation_name + '附近）' : ''}，午餐应靠近当天上午游览的景点，晚餐应靠近当天下午/傍晚游览的景点。从推荐美食列表中选择与当天景点位置最接近的餐厅，避免跨区用餐浪费时间

示例活动时间线（完整1天行程，午餐灵活推迟）：
07:00 早餐·广州·早茶（45分钟）→ 08:00 出发 → 08:30 必去景点（180分钟）→ 11:30 午餐·广州·炳胜品味（60分钟）→ 12:30 出发 → 13:00 可选景点（90分钟）→ 14:30 出发 → 15:00 必去景点（120分钟）→ 17:30 晚餐·广州·陶陶居（60分钟）→ 18:30 结束或夜间活动

示例（上午景点超时，午餐推迟）：
07:00 早餐·广州·早茶（45分钟）→ 08:00 出发 → 08:30 必去景点（240分钟，景区只进不出）→ 12:30 午餐·广州·炳胜品味（60分钟，景区出口附近）→ 13:30 出发 → 14:00 可选景点（90分钟）→ 15:30 出发 → 16:00 必去景点（90分钟）→ 17:30 晚餐·广州·陶陶居（60分钟）→ 18:30 结束

示例活动时间线（半天行程，如第1天下午到达）：
16:00 到达 → 16:30 可选景点（90分钟）→ 18:00 出发 → 18:30 晚餐·广州·陶陶居（60分钟）→ 19:30 结束

返回 JSON 格式：
{
  "title": "标题规则：以\"[目的地] \"开头（如[北京]、[新疆]、[杭州]），后接行程中最重要、最具代表性的2-3个景点用短横线连接，再接时长。相近区域的景点只取最重要的一个。半天用\"半日游\"（如[北京] 故宫-天安门 半日游），1天用\"一日游\"（如[杭州] 西湖-灵隐寺 一日游），2天及以上用\"X天Y晚\"（如[北京] 故宫-长城-颐和园 三天两晚）",
  "days": [
    {
      "day": 1,
      "activities": [
        { "name": "早餐·广州·早茶", "description": "品尝虾饺、烧卖等经典早茶", "location": "位置", "duration": 45, "time": "07:00", "address": "地址" },
        { "name": "景点名", "description": "描述", "location": "位置", "duration": 180, "time": "08:30", "address": "地址" },
        { "name": "午餐·广州·炳胜品味", "description": "描述", "location": "位置", "duration": 60, "time": "11:45", "address": "地址" },
        { "name": "景点名", "description": "描述", "location": "位置", "duration": 120, "time": "13:00", "address": "地址" },
        { "name": "晚餐·广州·陶陶居", "description": "描述", "location": "位置", "duration": 60, "time": "17:30", "address": "地址" }
      ]
    }
  ]
}`,
  }
}

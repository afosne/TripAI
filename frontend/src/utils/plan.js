export function getFirstActivityName(plan) {
  try {
    const itinerary = JSON.parse(plan.itinerary)
    const activities = itinerary?.days?.[0]?.activities
    if (!activities) return null
    const morning = activities.find(a => {
      if (!a.time) return false
      const t = parseInt(a.time.replace(':', ''), 10)
      if (isNaN(t)) return false
      if (t < 900) return false
      const meal = ['早餐', '午饭', '午餐', '中饭', '中餐', '晚餐', '晚饭']
      return !meal.some(kw => (a.name || '').includes(kw))
    })
    return morning?.name || activities[0]?.name || null
  } catch {
    return null
  }
}

export function getDayDate(startDate, dayIndex) {
  if (!startDate) return null
  const d = new Date(startDate)
  d.setDate(d.getDate() + dayIndex)
  return d
}

export const TIME_PERIODS = [
  { key: 'breakfast', label: '早餐', icon: '🍳' },
  { key: 'morning', label: '上午', icon: '🌅' },
  { key: 'lunch', label: '午餐', icon: '🍚' },
  { key: 'afternoon', label: '下午', icon: '☀️' },
  { key: 'dinner', label: '晚餐', icon: '🍽️' },
  { key: 'evening', label: '晚上', icon: '🌙' },
]

const MEAL_KEYWORDS = {
  breakfast: ['早餐', '早饭', '早茶', '早点', '早市', '清晨'],
  lunch: ['午餐', '午饭', '中饭', '中餐', '午间'],
  dinner: ['晚餐', '晚饭', '晚宴', '夜宵', '宵夜'],
}

function getMealPeriod(act) {
  const text = `${act.name || ''} ${act.description || ''}`
  for (const [period, keywords] of Object.entries(MEAL_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return period
  }
  return null
}

export function groupByTimePeriod(activities) {
  return TIME_PERIODS.map(period => {
    const items = (activities || []).filter(act => {
      const mealPeriod = getMealPeriod(act)
      if (mealPeriod) return period.key === mealPeriod
      if (period.key === 'breakfast' || period.key === 'lunch' || period.key === 'dinner') return false
      if (!act.time) return period.key === 'morning'
      const digits = act.time.replace(':', '')
      const t = parseInt(digits, 10)
      if (isNaN(t)) return period.key === 'morning'
      if (period.key === 'morning' && t < 1130) return true
      if (period.key === 'afternoon' && t >= 1130 && t < 1730) return true
      if (period.key === 'evening' && t >= 1730) return true
      if (period.key === 'afternoon' && t < 1130) {
        return t + (act.duration || 0) > 1130
      }
      return false
    }).filter(Boolean)
    return items.length > 0 ? { ...period, activities: items } : null
  }).filter(Boolean)
}

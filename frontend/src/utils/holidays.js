// 中国法定节假日数据 (含调休安排)
// 每年需更新: holiday_dates 为放假日期, makeup_workdays 为调休上班日期

const HOLIDAYS = {
  2025: {
    holiday_dates: {
      '2025-01-01': '元旦',
      '2025-01-28': '春节', '2025-01-29': '春节', '2025-01-30': '春节', '2025-01-31': '春节',
      '2025-02-01': '春节', '2025-02-02': '春节', '2025-02-03': '春节', '2025-02-04': '春节',
      '2025-04-04': '清明节', '2025-04-05': '清明节', '2025-04-06': '清明节',
      '2025-05-01': '劳动节', '2025-05-02': '劳动节', '2025-05-03': '劳动节',
      '2025-05-04': '劳动节', '2025-05-05': '劳动节',
      '2025-05-31': '端午节', '2025-06-01': '端午节', '2025-06-02': '端午节',
      '2025-10-01': '国庆节', '2025-10-02': '国庆节', '2025-10-03': '国庆节',
      '2025-10-04': '国庆节', '2025-10-05': '国庆节', '2025-10-06': '中秋/国庆',
      '2025-10-07': '国庆节', '2025-10-08': '国庆节',
    },
    makeup_workdays: ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'],
  },
  2026: {
    holiday_dates: {
      '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
      '2026-02-15': '春节', '2026-02-16': '春节', '2026-02-17': '春节',
      '2026-02-18': '春节', '2026-02-19': '春节', '2026-02-20': '春节', '2026-02-21': '春节',
      '2026-04-04': '清明节', '2026-04-05': '清明节', '2026-04-06': '清明节',
      '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节',
      '2026-05-04': '劳动节', '2026-05-05': '劳动节',
      '2026-06-19': '端午节', '2026-06-20': '端午节', '2026-06-21': '端午节',
      '2026-10-01': '国庆节', '2026-10-02': '国庆节', '2026-10-03': '国庆节',
      '2026-10-04': '中秋/国庆', '2026-10-05': '国庆节', '2026-10-06': '国庆节',
      '2026-10-07': '国庆节', '2026-10-08': '国庆节',
    },
    makeup_workdays: ['2026-02-14', '2026-02-22', '2026-04-26', '2026-09-27', '2026-10-10'],
  },
}

function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getYearData(year) {
  return HOLIDAYS[year] || null
}

/**
 * 获取日期类型
 * @param {string|Date} date - 日期
 * @returns {{ type: 'holiday'|'weekend'|'workday', name?: string }}
 */
function getDateType(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateStr = formatDate(d)
  const year = d.getFullYear()
  const data = getYearData(year)

  if (data) {
    if (data.holiday_dates[dateStr]) {
      return { type: 'holiday', name: data.holiday_dates[dateStr] }
    }
    if (data.makeup_workdays.includes(dateStr)) {
      return { type: 'workday' }
    }
  }

  const day = d.getDay()
  if (day === 0 || day === 6) {
    return { type: 'weekend' }
  }
  return { type: 'workday' }
}

/**
 * 获取日期显示文本
 * @param {string|Date} date
 * @returns {string} e.g. "周六", "元旦(周三)", "工作日(周六)"
 */
function getDateLabel(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const { type, name } = getDateType(d)
  const weekday = weekDays[d.getDay()]

  if (type === 'holiday') {
    return `${name}(${weekday})`
  }
  if (type === 'workday' && (d.getDay() === 0 || d.getDay() === 6)) {
    return `工作日(${weekday})`
  }
  return weekday
}

/**
 * 获取日期的简短显示文本 (用于行程页面的日期标注)
 * @param {string|Date} date
 * @returns {string} e.g. "1月1日 周三", "1月1日 元旦", "1月26日 工作日(周日)"
 */
export function getDateDisplay(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`
  const label = getDateLabel(d)
  return `${dateStr} ${label}`
}

/**
 * 计算日期范围内的工作日/周末/节假日统计
 */
export function analyzeDates(startDate, endDate) {
  let weekdays = 0, weekends = 0, holidays = 0
  const holidayNames = new Set()

  const d = new Date(startDate)
  const end = new Date(endDate)
  while (d <= end) {
    const { type, name } = getDateType(d)
    if (type === 'holiday') {
      holidays++
      if (name) holidayNames.add(name)
    } else if (type === 'weekend') {
      weekends++
    } else {
      weekdays++
    }
    d.setDate(d.getDate() + 1)
  }

  return { weekdays, weekends, holidays, holidayNames: [...holidayNames] }
}

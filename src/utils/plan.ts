export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

export function validatePlanParams(params: any): boolean {
  if (!params.destination || typeof params.destination !== 'string') {
    return false
  }
  if (!params.days || typeof params.days !== 'number' || params.days < 1) {
    return false
  }
  if (params.start_date && params.end_date) {
    const diff = Math.round((new Date(params.end_date).getTime() - new Date(params.start_date).getTime()) / 86400000) + 1
    if (diff > 30) return false
  }
  return true
}

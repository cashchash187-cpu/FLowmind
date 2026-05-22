export const PLAN_LIMITS = {
  free:     { audioMinutes: 60,       aiRequests: 20,      researchRequests: 0,        historyDays: 3,    concurrent: 1,  insightMode: false, label: 'Free' },
  pro:      { audioMinutes: 1500,     aiRequests: 1000,    researchRequests: 100,       historyDays: null, concurrent: 3,  insightMode: true,  label: 'Pro' },
  business: { audioMinutes: 7200,     aiRequests: 10000,   researchRequests: 1000,      historyDays: null, concurrent: 10, insightMode: true,  label: 'Business' },
  admin:    { audioMinutes: Infinity, aiRequests: Infinity, researchRequests: Infinity,  historyDays: null, concurrent: 99, insightMode: true,  label: 'Admin' },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
}

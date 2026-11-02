// Goal types (stage 2.6). The DB check in 20261008000000_stage2.sql lists the same ids.
export const GOAL_TYPES = [
  { id: 'personal', label: 'אישי' }, { id: 'business', label: 'עסקי' }, { id: 'branch', label: 'סניף' },
  { id: 'financial', label: 'פיננסי' }, { id: 'study', label: 'לימודים' }, { id: 'ventures', label: 'יזמות' },
] as const;
export type GoalType = (typeof GOAL_TYPES)[number]['id'];
export const goalTypeLabel = (id: string | null) => GOAL_TYPES.find(t => t.id === id)?.label ?? null;

// The type a new goal starts with, from where it is added
export function defaultGoalTypeFor(p: { domain: string; branch?: string | null; location?: string | null }, unit = 'ils'): GoalType {
  if (p.location) return 'branch';
  if (p.domain === 'ventures') return 'ventures';
  if (p.domain === 'business') return 'business';
  return unit === 'ils' ? 'financial' : 'personal';
}

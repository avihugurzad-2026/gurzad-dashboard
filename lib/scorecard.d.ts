type Rec = Record<string, unknown>;

export type Cell = { period: string; value: number | null; status: 'on' | 'off' | null };

declare const scorecard: {
  LOCK_DAYS: number;
  lastWeeks(todayIso: string, n?: number): string[];
  status(value: unknown, goal: unknown, direction: unknown): 'on' | 'off' | null;
  measureRow(measure: Rec, snapshots: Rec[], weeks: string[]): Rec & { cells: Cell[]; latest: Cell | null; suggest_issue: boolean };
  goalChange(measure: Rec, todayIso: string, opts?: { quarterlyPlanning?: boolean }):
    { ok: true; effective_from: string; locked_until: string } | { ok: false; reason: string };
  validGoal(v: unknown): boolean;
};
export = scorecard;

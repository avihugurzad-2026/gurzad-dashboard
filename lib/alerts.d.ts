type Rec = Record<string, unknown>;

export type PanelItem = {
  id: number | null; rule_id: string; severity: 'red' | 'orange'; title: string;
  amount?: number | null; days?: number | null; open_days: number | null;
  counterparty?: string | null; suggested_action?: string | null; owner?: string | null; branch?: string | null;
  first_seen?: string; snoozed_until?: string | null;
};

declare const alerts: {
  alertParams(rows: Rec[], todayIso: string): Rec;
  evaluateRules(input: Rec): Rec[];
  noticeDeadline(d: Rec): string | null;
  reconcileAlerts(existing: Rec[], found: Rec[], todayIso: string): Rec;
  applyAlerts(client: unknown, input: Rec): Promise<Rec>;
  panelItems(open: Rec[], todayIso: string, max?: number): { items: PanelItem[]; more: number; snoozed: number };
  validSnooze(until: unknown, todayIso: string): boolean;
};
export = alerts;

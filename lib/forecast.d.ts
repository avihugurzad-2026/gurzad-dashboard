type Rec = Record<string, unknown>;

export type ForecastWeek = { start: string; in: number; out: number; closing: number | null };
export type CashPosition = { operating: number | null; restricted: number | null; reserve: number | null };
export type Forecast = {
  scenario: string; start: string; end: string;
  weeks: ForecastWeek[]; cash: CashPosition;
  trough: { week: string; amount: number } | null;
  floor: number | null; below_floor: boolean | null; weeks_of_spend: number | null;
  partial: boolean; missing: { key: string; text: string }[];
};
export type Scenarios = { base: Forecast; late_collection: Forecast; lose_top_client: Forecast };

declare const forecast: {
  WEEKS: number;
  weekStart(dIso: string): string;
  addDaysIso(dIso: string, n: number): string;
  addMonthsIso(dIso: string, n: number): string;
  cashPosition(accounts: Rec[]): CashPosition;
  occurrences(nextDue: unknown, frequency: unknown, endIso: string): string[];
  buildForecast(input: Rec, scenario?: string): Forecast;
  buildScenarios(input: Rec): Scenarios;
};
export = forecast;

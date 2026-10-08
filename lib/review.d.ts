type Rec = Record<string, unknown>;

declare const review: {
  weekToDate(isoWeek: unknown, isoDay?: number): string | null;
  validateDecisions(decisions: unknown): { ok: boolean; errors: string[] };
  exportMarkdown(review: Rec): string;
};
export = review;

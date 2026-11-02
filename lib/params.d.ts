type Rec = Record<string, unknown>;

declare const params: {
  paramAt(rows: Rec[], key: string, dateIso: string): unknown;
  vatRateAt(rows: Rec[], dateIso: string): number | null;
  allocationThresholdAt(rows: Rec[], dateIso: string): number | null;
};
export = params;

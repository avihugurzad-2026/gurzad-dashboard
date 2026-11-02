type Rec = Record<string, unknown>;

declare const snapshots: {
  ALL: string;
  isoWeek(dIso: string): string;
  buildSnapshotRows(input: Rec): Rec[];
  writeSnapshots(client: unknown, rows: Rec[]): Promise<number>;
  UPSERT_SQL: string;
};
export = snapshots;

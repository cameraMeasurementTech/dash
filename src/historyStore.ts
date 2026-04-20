export const HISTORY_STORAGE_KEY = "affine-rank-score-history-v1";

const MAX_SNAPSHOTS = 2000;

export interface StoredMinerSnapshot {
  uid: number;
  hotkey: string;
  model: string;
  averageScore: number;
  scoresByEnv: Record<
    string,
    { score?: number; historical_count?: number; sample_count?: number }
  >;
}

export interface HistorySnapshot {
  collectedAt: number;
  blockNumber: number;
  calculatedAt: number;
  envNames: string[];
  miners: StoredMinerSnapshot[];
}

export function loadSnapshots(): HistorySnapshot[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistorySnapshot);
  } catch {
    return [];
  }
}

function isHistorySnapshot(x: unknown): x is HistorySnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.collectedAt === "number" &&
    typeof o.blockNumber === "number" &&
    typeof o.calculatedAt === "number" &&
    Array.isArray(o.envNames) &&
    Array.isArray(o.miners)
  );
}

function saveSnapshots(snaps: HistorySnapshot[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(snaps));
  } catch {
    /* quota — drop oldest half and retry once */
    const half = snaps.slice(Math.floor(snaps.length / 2));
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(half));
    } catch {
      /* ignore */
    }
  }
}

function trim(snaps: HistorySnapshot[]): HistorySnapshot[] {
  if (snaps.length <= MAX_SNAPSHOTS) return snaps;
  return snaps.slice(-MAX_SNAPSHOTS);
}

/** Append or replace last if same block + calculatedAt (dedupe refresh). */
export function appendSnapshot(input: Omit<HistorySnapshot, "collectedAt"> & {
  collectedAt?: number;
}): HistorySnapshot[] {
  const prev = loadSnapshots();
  const snap: HistorySnapshot = {
    ...input,
    collectedAt: input.collectedAt ?? Date.now(),
  };

  const last = prev[prev.length - 1];
  let next: HistorySnapshot[];
  if (
    last &&
    last.blockNumber === snap.blockNumber &&
    last.calculatedAt === snap.calculatedAt
  ) {
    next = [...prev.slice(0, -1), snap];
  } else {
    next = [...prev, snap];
  }
  next = trim(next);
  saveSnapshots(next);
  return next;
}

export function exportHistoryJson(): string {
  return JSON.stringify(loadSnapshots(), null, 2);
}

/** Percent points (0–100) for one miner + env across snapshots. */
export function seriesEnvPercent(
  snapshots: HistorySnapshot[],
  uid: number,
  env: string
): { x: number; v: number }[] {
  const out: { x: number; v: number }[] = [];
  snapshots.forEach((snap, idx) => {
    const miner = snap.miners.find((m) => m.uid === uid);
    const s = miner?.scoresByEnv[env]?.score;
    if (typeof s === "number" && Number.isFinite(s)) {
      out.push({ x: idx, v: s * 100 });
    }
  });
  return out;
}

export function seriesAveragePercent(
  snapshots: HistorySnapshot[],
  uid: number
): { x: number; v: number }[] {
  const out: { x: number; v: number }[] = [];
  snapshots.forEach((snap, idx) => {
    const miner = snap.miners.find((m) => m.uid === uid);
    const a = miner?.averageScore;
    if (typeof a === "number" && Number.isFinite(a)) {
      out.push({ x: idx, v: a * 100 });
    }
  });
  return out;
}

import { buildRowDisplay } from "./rankLogic";
import type { RankedMiner } from "./types";

export type SortColumn =
  | { kind: "hotkey" }
  | { kind: "uid" }
  | { kind: "model" }
  | { kind: "env"; env: string }
  | { kind: "avg" }
  | { kind: "status" }
  | { kind: "cp" }
  | { kind: "challenge" };

export type SortState = { col: SortColumn; dir: "asc" | "desc" } | null;

export type SortContext = {
  envNames: string[];
  dethroneCp: number;
  terminationM: number;
};

export function sameColumn(a: SortColumn, b: SortColumn): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "env" && b.kind === "env") return a.env === b.env;
  return true;
}

/** First click direction: numeric / CP / UID high-first; text A→Z first. */
function defaultDir(col: SortColumn): "asc" | "desc" {
  switch (col.kind) {
    case "avg":
    case "env":
    case "cp":
    case "uid":
      return "desc";
    default:
      return "asc";
  }
}

/** Cycle: set column → opposite direction → clear. */
export function toggleSortState(prev: SortState, col: SortColumn): SortState {
  const def = defaultDir(col);
  if (!prev || !sameColumn(prev.col, col)) {
    return { col, dir: def };
  }
  if (prev.dir === def) {
    return { col, dir: def === "asc" ? "desc" : "asc" };
  }
  return null;
}

function envRawScore(m: RankedMiner, env: string): number {
  const s = m.scoresByEnv[env]?.score;
  return typeof s === "number" && Number.isFinite(s) ? s : -1;
}

function cpSortValue(m: RankedMiner): number {
  if (m.isChampion) return Number.POSITIVE_INFINITY;
  return m.checkpointsPassed;
}

function comparePrimary(
  a: RankedMiner,
  b: RankedMiner,
  col: SortColumn,
  ctx: SortContext
): number {
  switch (col.kind) {
    case "uid":
      return a.uid - b.uid;
    case "hotkey":
      return a.hotkey.localeCompare(b.hotkey);
    case "model":
      return a.model.localeCompare(b.model);
    case "avg":
      return a.averageScore - b.averageScore;
    case "env":
      return envRawScore(a, col.env) - envRawScore(b, col.env);
    case "status": {
      const ra = buildRowDisplay(a, ctx.envNames, ctx.dethroneCp, ctx.terminationM);
      const rb = buildRowDisplay(b, ctx.envNames, ctx.dethroneCp, ctx.terminationM);
      return ra.statusStr.localeCompare(rb.statusStr);
    }
    case "cp":
      return cpSortValue(a) - cpSortValue(b);
    case "challenge": {
      const ra = buildRowDisplay(a, ctx.envNames, ctx.dethroneCp, ctx.terminationM);
      const rb = buildRowDisplay(b, ctx.envNames, ctx.dethroneCp, ctx.terminationM);
      return ra.challengeStr.localeCompare(rb.challengeStr);
    }
  }
}

export function sortMinersList(
  miners: RankedMiner[],
  sort: SortState,
  ctx: SortContext
): RankedMiner[] {
  if (!sort) return miners;
  const mult = sort.dir === "asc" ? 1 : -1;
  return [...miners].sort((a, b) => {
    const p = comparePrimary(a, b, sort.col, ctx);
    if (p !== 0) return p * mult;
    return a.uid - b.uid;
  });
}

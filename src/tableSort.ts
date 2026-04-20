import {
  buildChallengeColumnDisplay,
  challengeMinerForDisplay,
} from "./rankLogic";
import type { RankedMiner } from "./types";

export type SortColumn =
  | { kind: "rank" }
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
  /**
   * When non-null and non-empty: Status/CP/Challenge prefer v1 `challenge_info`
   * (same as `af get-rank`). When null/empty: use each row’s own fields (www snapshot).
   */
  v1ChallengeMiners: RankedMiner[] | null;
  /** False when public www scores omit `challenge_info` (Status/CP/Challenge are "—"). */
  challengeInfoAvailable: boolean;
};

export function sameColumn(a: SortColumn, b: SortColumn): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "env" && b.kind === "env") return a.env === b.env;
  return true;
}

/** First click direction: numeric / CP / UID high-first; text A→Z first. */
function defaultDir(col: SortColumn): "asc" | "desc" {
  switch (col.kind) {
    case "rank":
      // Rank 1 is best; ascending shows 1, 2, 3… first.
      return "asc";
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

function cpSortValueChallenge(m: RankedMiner, ctx: SortContext): number {
  if (!ctx.challengeInfoAvailable) return 0;
  const c = challengeMinerForDisplay(m, ctx.v1ChallengeMiners);
  if (c.isChampion) return Number.POSITIVE_INFINITY;
  return c.checkpointsPassed;
}

/** Missing rank sorts after finite ranks when ascending. */
function rankSortValue(m: RankedMiner): number {
  if (typeof m.rank === "number" && Number.isFinite(m.rank)) return m.rank;
  return Number.POSITIVE_INFINITY;
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
    case "rank":
      return rankSortValue(a) - rankSortValue(b);
    case "model":
      return a.model.localeCompare(b.model);
    case "avg":
      return a.averageScore - b.averageScore;
    case "env":
      return envRawScore(a, col.env) - envRawScore(b, col.env);
    case "status": {
      const ra = buildChallengeColumnDisplay(
        a,
        ctx.v1ChallengeMiners,
        ctx.envNames,
        ctx.dethroneCp,
        ctx.terminationM,
        ctx.challengeInfoAvailable
      );
      const rb = buildChallengeColumnDisplay(
        b,
        ctx.v1ChallengeMiners,
        ctx.envNames,
        ctx.dethroneCp,
        ctx.terminationM,
        ctx.challengeInfoAvailable
      );
      return ra.statusStr.localeCompare(rb.statusStr);
    }
    case "cp":
      return cpSortValueChallenge(a, ctx) - cpSortValueChallenge(b, ctx);
    case "challenge": {
      const ra = buildChallengeColumnDisplay(
        a,
        ctx.v1ChallengeMiners,
        ctx.envNames,
        ctx.dethroneCp,
        ctx.terminationM,
        ctx.challengeInfoAvailable
      );
      const rb = buildChallengeColumnDisplay(
        b,
        ctx.v1ChallengeMiners,
        ctx.envNames,
        ctx.dethroneCp,
        ctx.terminationM,
        ctx.challengeInfoAvailable
      );
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

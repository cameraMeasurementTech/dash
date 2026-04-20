import type {
  ChampionState,
  EnvConfig,
  RankedMiner,
  RawMinerScore,
} from "./types";

export function parseEnvironments(
  paramValue: Record<string, EnvConfig> | undefined
): { names: string[]; configs: Record<string, EnvConfig> } {
  if (!paramValue || typeof paramValue !== "object") {
    return { names: [], configs: {} };
  }
  const names: string[] = [];
  const configs: Record<string, EnvConfig> = {};
  for (const [envName, envConfig] of Object.entries(paramValue)) {
    if (
      envConfig &&
      typeof envConfig === "object" &&
      envConfig.enabled_for_scoring === true
    ) {
      names.push(envName);
      configs[envName] = envConfig;
    }
  }
  names.sort();
  return { names, configs };
}

export function envDisplayName(env: string, envCfg: EnvConfig | undefined): string {
  if (envCfg && typeof envCfg.display_name === "string" && envCfg.display_name) {
    return envCfg.display_name;
  }
  const idx = env.indexOf(":");
  if (idx !== -1) return env.slice(idx + 1);
  return env;
}

/** Column order: first-seen keys walking miners (API insertion order), then any new keys. */
export function inferEnvNamesFromMiners(miners: RankedMiner[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of miners) {
    if (!m.scoresByEnv || typeof m.scoresByEnv !== "object") continue;
    for (const k of Object.keys(m.scoresByEnv)) {
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(k);
    }
  }
  return ordered;
}

/** Keep env columns only if at least one miner has a non-zero score for that env. */
export function filterEnvNamesWithNonZeroScores(
  miners: RankedMiner[],
  envNames: string[]
): string[] {
  const filtered = envNames.filter((env) =>
    miners.some((m) => {
      const s = m.scoresByEnv[env]?.score;
      return typeof s === "number" && Number.isFinite(s) && s !== 0;
    })
  );
  return filtered.length > 0 ? filtered : envNames;
}

/** Like Python `int(x or 0)` for challenge counters. */
function parseChallengeInt(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

/** Match Python `ci.get("status", "sampling")` semantics for string status. */
function parseChallengeStatus(ci: Record<string, unknown>): string {
  const st = ci.status;
  if (st == null) return "sampling";
  if (typeof st === "string") return st;
  return String(st);
}

export function isTerminatedStatus(status: string): boolean {
  return status.trim().toLowerCase() === "terminated";
}

/** True if the payload includes per-miner `challenge_info` (v1 yes; public www scores/latest currently no). */
export function scoresListHasChallengeInfo(list: RawMinerScore[]): boolean {
  if (!list.length) return false;
  return list.some((s) => {
    const ci = s.challenge_info;
    if (ci == null) return false;
    if (typeof ci !== "object") return false;
    return Object.keys(ci as object).length > 0;
  });
}

export function parseRankedMiners(scoresList: RawMinerScore[]): RankedMiner[] {
  return scoresList.map((s) => {
    const ci = (s.challenge_info ?? {}) as Record<string, unknown>;
    const rawRank = s.rank;
    const rank =
      typeof rawRank === "number" && Number.isFinite(rawRank) ? rawRank : null;
    return {
      uid: s.uid ?? 0,
      hotkey: s.miner_hotkey ?? "",
      rank,
      model: s.model ?? "",
      scoresByEnv: s.scores_by_env ?? {},
      averageScore: s.average_score ?? 0,
      isChampion: Boolean(ci.is_champion),
      status: parseChallengeStatus(ci),
      consecutiveWins: parseChallengeInt(ci.consecutive_wins),
      totalLosses: parseChallengeInt(ci.total_losses),
      consecutiveLosses: parseChallengeInt(ci.consecutive_losses),
      checkpointsPassed: parseChallengeInt(ci.checkpoints_passed),
    };
  });
}

/** Resolve legacy api.affine.io row for challenge fields (same hotkey, else uid). */
export function lookupLegacyMiner(
  m: RankedMiner,
  legacyList: RankedMiner[]
): RankedMiner | undefined {
  if (!legacyList.length) return undefined;
  if (m.hotkey) {
    const hit = legacyList.find((l) => l.hotkey === m.hotkey);
    if (hit) return hit;
  }
  const matches = legacyList.filter((l) => l.uid === m.uid);
  if (matches.length === 1) return matches[0];
  return matches.find((l) => l.hotkey === m.hotkey);
}

/**
 * v1 `/scores/latest` row for this table row (same identity as `af get-rank`).
 * Returns undefined when there is no v1 list or no matching v1 row.
 */
export function v1MinerForMergedRow(
  m: RankedMiner,
  v1ChallengeMiners: RankedMiner[] | null | undefined
): RankedMiner | undefined {
  if (!v1ChallengeMiners?.length) return undefined;
  return lookupLegacyMiner(m, v1ChallengeMiners);
}

/**
 * Miner record used for Status / CP / Challenge (display, sort, filters, footer).
 * When v1 loaded: use v1 `challenge_info` (matches `af get-rank`), else same row
 * (still v1-backed after www merge). When v1 did not load: use the table row from
 * www `scores[].challenge_info` so the UI is not blank in browser-only mode.
 */
export function challengeMinerForDisplay(
  mergedRow: RankedMiner,
  v1ChallengeMiners: RankedMiner[] | null | undefined
): RankedMiner {
  if (!v1ChallengeMiners?.length) return mergedRow;
  return v1MinerForMergedRow(mergedRow, v1ChallengeMiners) ?? mergedRow;
}

/**
 * Same row identity as `af get-rank`: legacy api.affine.io miners carry
 * `challenge_info` (Status / CP / Challenge). Overlay www.affine.io fields
 * (rank, avg, scores_by_env, model) when the hotkey matches, else by uid
 * when unambiguous — mirrors Python `parse_ranked_miners` + single snapshot.
 */
export function mergeWwwScoresOntoLegacy(
  legacyMiners: RankedMiner[],
  wwwList: RawMinerScore[]
): RankedMiner[] {
  const byHotkey = new Map<string, RawMinerScore>();
  for (const s of wwwList) {
    const hk = s.miner_hotkey ?? "";
    if (hk) byHotkey.set(hk, s);
  }
  const byUid = new Map<number, RawMinerScore[]>();
  for (const s of wwwList) {
    const uid = s.uid ?? 0;
    const arr = byUid.get(uid) ?? [];
    arr.push(s);
    byUid.set(uid, arr);
  }

  function pickWww(m: RankedMiner): RawMinerScore | undefined {
    if (m.hotkey) {
      const w = byHotkey.get(m.hotkey);
      if (w) return w;
    }
    const list = byUid.get(m.uid);
    if (list?.length === 1) return list[0];
    if (list?.length && m.hotkey) {
      return list.find((s) => (s.miner_hotkey ?? "") === m.hotkey);
    }
    return undefined;
  }

  return legacyMiners.map((m) => {
    const w = pickWww(m);
    if (!w) return m;
    const rawRank = w.rank;
    const rank =
      typeof rawRank === "number" && Number.isFinite(rawRank) ? rawRank : null;
    return {
      ...m,
      rank,
      model: w.model ?? m.model,
      averageScore:
        typeof w.average_score === "number" && Number.isFinite(w.average_score)
          ? w.average_score
          : m.averageScore,
      scoresByEnv:
        w.scores_by_env && typeof w.scores_by_env === "object"
          ? w.scores_by_env
          : m.scoresByEnv,
    };
  });
}

function sortKey(m: RankedMiner): number[] {
  if (m.isChampion) return [0];
  if (isTerminatedStatus(m.status)) {
    return [2, -m.totalLosses, -m.checkpointsPassed];
  }
  return [1, -m.checkpointsPassed, -m.averageScore];
}

export function sortRankedMiners(miners: RankedMiner[]): RankedMiner[] {
  return [...miners].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    const n = Math.max(ka.length, kb.length);
    for (let i = 0; i < n; i++) {
      const va = ka[i] ?? 0;
      const vb = kb[i] ?? 0;
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });
}

export function formatRelativeTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || epochSeconds === 0) return "unknown";
  const delta = Math.floor(Date.now() / 1000) - Math.floor(Number(epochSeconds));
  if (delta < 0) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) {
    const h = Math.floor(delta / 3600);
    const m = Math.floor((delta % 3600) / 60);
    return `${h}h ${m}m ago`;
  }
  return `${Math.floor(delta / 86400)}d ago`;
}

export function formatIso(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || epochSeconds === 0) return "unknown";
  const d = new Date(Math.floor(Number(epochSeconds)) * 1000);
  return (
    d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
  );
}

/** API fractions in 0–1 (score, average, completeness, min_completeness, …). */
export function fractionToPercentDisplay(
  value: number | undefined | null,
  fractionDigits = 2
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatEnvCell(
  env: string,
  scoresByEnv: RankedMiner["scoresByEnv"]
): string {
  const envData = scoresByEnv[env];
  if (!envData) return "  -  ";
  const envScore = envData.score ?? 0;
  const historical =
    envData.historical_count ?? envData.sample_count ?? 0;
  const scorePercent = envScore * 100;
  return `${scorePercent.toFixed(2)}%/${historical}`;
}

/** `min_completeness` per env from www `GET …/system/config` → `param_value`. */
export function parseMinCompletenessByEnv(
  paramValue: Record<string, EnvConfig> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!paramValue || typeof paramValue !== "object") return out;
  for (const [name, cfg] of Object.entries(paramValue)) {
    if (!cfg || typeof cfg !== "object") continue;
    const raw = cfg.min_completeness;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Eligible when miner completeness **meets or exceeds** the configured minimum
 * (same threshold semantics as scoring gates).
 */
export function envCompletenessMeetsMin(
  completeness: number | undefined,
  minRequired: number | undefined
): boolean {
  if (minRequired == null || !Number.isFinite(minRequired)) return false;
  if (completeness == null || !Number.isFinite(completeness)) return false;
  return completeness >= minRequired;
}

export interface ScorerConfig {
  dethroneCp: number;
  terminationLosses: number;
}

export function readScorerConfig(
  config: Record<string, unknown> | undefined
): ScorerConfig {
  const rawDethrone = config?.champion_dethrone_min_checkpoint;
  const rawM = config?.champion_termination_total_losses;
  const dethroneCp =
    typeof rawDethrone === "number" && Number.isFinite(rawDethrone)
      ? rawDethrone
      : 10;
  const terminationLosses =
    typeof rawM === "number" && Number.isFinite(rawM) ? rawM : 3;
  return { dethroneCp, terminationLosses };
}

export interface RowDisplay {
  hotkey8: string;
  uidStr: string;
  model25: string;
  envCells: string[];
  statusStr: string;
  cpStr: string;
  challengeStr: string;
}

export function buildRowDisplay(
  m: RankedMiner,
  environments: string[],
  dethroneCp: number,
  M: number
): RowDisplay {
  const hotkey8 = (m.hotkey || "").slice(0, 8).padEnd(8, " ");
  const uidStr = String(m.uid).padStart(4, " ");
  const model25 = (m.model || "").slice(0, 25).padEnd(25, " ");
  const envCells = environments.map((env) => formatEnvCell(env, m.scoresByEnv));

  let statusStr: string;
  let cpStr: string;
  let challengeStr: string;

  if (m.isChampion) {
    statusStr = "★ CHAMPION";
    cpStr = "—";
    challengeStr = "—";
  } else if (isTerminatedStatus(m.status)) {
    statusStr = "TERMINATED";
    cpStr = String(m.checkpointsPassed);
    challengeStr =
      m.totalLosses === 0 ? "pairwise" : `L:${m.totalLosses}/${M}`;
  } else {
    statusStr = "sampling";
    cpStr = `${m.checkpointsPassed}/${dethroneCp}`;
    if (m.checkpointsPassed >= dethroneCp && m.consecutiveWins > 0) {
      challengeStr = "READY";
    } else if (m.totalLosses > 0) {
      challengeStr = `L:${m.totalLosses}/${M}`;
    } else {
      challengeStr = "—";
    }
  }

  return {
    hotkey8,
    uidStr,
    model25,
    envCells,
    statusStr,
    cpStr,
    challengeStr,
  };
}

/** Status / CP / Challenge from `challengeMinerForDisplay` + `buildRowDisplay`. */
export interface ChallengeColumnDisplay {
  statusStr: string;
  cpStr: string;
  challengeStr: string;
  isChampion: boolean;
  isTerminated: boolean;
}

export function buildChallengeColumnDisplay(
  mergedRow: RankedMiner,
  v1ChallengeMiners: RankedMiner[] | null | undefined,
  envNames: string[],
  dethroneCp: number,
  M: number,
  challengeInfoAvailable = true
): ChallengeColumnDisplay {
  if (!challengeInfoAvailable) {
    return {
      statusStr: "—",
      cpStr: "—",
      challengeStr: "—",
      isChampion: false,
      isTerminated: false,
    };
  }
  const source = challengeMinerForDisplay(mergedRow, v1ChallengeMiners);
  const row = buildRowDisplay(source, envNames, dethroneCp, M);
  return {
    statusStr: row.statusStr,
    cpStr: row.cpStr,
    challengeStr: row.challengeStr,
    isChampion: source.isChampion,
    isTerminated: isTerminatedStatus(source.status),
  };
}

export function championBannerLines(
  blockNumber: number,
  championState: ChampionState | null,
  miners: RankedMiner[],
  v1ChallengeMiners?: RankedMiner[] | null,
  challengeInfoAvailable = true
): string {
  if (!challengeInfoAvailable) {
    if (championState) {
      const champHk = ((championState.hotkey as string) || "").slice(0, 8);
      const sinceBlock = championState.since_block;
      return (
        `Champion:   ${champHk}... since block ${sinceBlock} ` +
        `(www snapshot has no challenge_info — table cannot show champion row)`
      );
    }
    return (
      "Champion:   (unknown — www `scores/latest` does not include `challenge_info`; " +
      "load v1 `/scores/latest` + `/config/champion` or use `af get-rank`)"
    );
  }
  const championPresentUid =
    miners
      .map((m) => challengeMinerForDisplay(m, v1ChallengeMiners))
      .find((c) => c.isChampion)?.uid ?? null;
  if (championState) {
    const champHk = ((championState.hotkey as string) || "").slice(0, 8);
    const sinceBlock = championState.since_block;
    const tenure =
      sinceBlock != null ? blockNumber - Number(sinceBlock) : null;
    const tenureStr =
      tenure != null ? `Δ ${tenure} blocks` : "tenure unknown";
    if (championPresentUid != null) {
      return `Champion:   ${champHk}... reigning since block ${sinceBlock} (${tenureStr})`;
    }
    return (
      `Champion:   ${champHk}... reigning since block ${sinceBlock} ` +
      `(${tenureStr}, offline this round)`
    );
  }
  if (championPresentUid != null) {
    return (
      `Champion:   UID ${championPresentUid} in this snapshot ` +
      `(v1 /config/champion not loaded — hotkey / tenure line needs api.affine.io)`
    );
  }
  return "Champion:   (none — cold start)";
}

export function footerSummary(
  miners: RankedMiner[],
  championState: ChampionState | null,
  v1ChallengeMiners?: RankedMiner[] | null,
  challengeInfoAvailable = true
): string {
  if (!challengeInfoAvailable) {
    return (
      `Total: ${miners.length}  |  ` +
      `Sampling / Terminated / champion counts need v1 scores (include challenge_info), same as af get-rank.`
    );
  }
  const samplingCount = miners.filter((m) => {
    const c = challengeMinerForDisplay(m, v1ChallengeMiners);
    return c.status === "sampling" && !c.isChampion;
  }).length;
  const terminatedCount = miners.filter((m) =>
    isTerminatedStatus(challengeMinerForDisplay(m, v1ChallengeMiners).status)
  ).length;
  const championPresentUid =
    miners
      .map((m) => challengeMinerForDisplay(m, v1ChallengeMiners))
      .find((c) => c.isChampion)?.uid ?? null;

  let champSummary: string;
  if (championPresentUid != null) {
    champSummary = `Champion: 1 (UID ${championPresentUid})`;
  } else if (championState) {
    const uid = championState.uid;
    champSummary = `Champion: 0 (last: UID ${uid}, offline)`;
  } else {
    champSummary = "Champion: 0 (cold start)";
  }

  return (
    `Total: ${miners.length}  |  ${champSummary}  |  ` +
    `Sampling: ${samplingCount}  |  Terminated: ${terminatedCount}`
  );
}

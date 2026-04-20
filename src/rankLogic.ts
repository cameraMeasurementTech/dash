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

export function parseRankedMiners(scoresList: RawMinerScore[]): RankedMiner[] {
  return scoresList.map((s) => {
    const ci = s.challenge_info ?? {};
    return {
      uid: s.uid ?? 0,
      hotkey: s.miner_hotkey ?? "",
      model: s.model ?? "",
      scoresByEnv: s.scores_by_env ?? {},
      averageScore: s.average_score ?? 0,
      isChampion: Boolean(ci.is_champion),
      status: typeof ci.status === "string" ? ci.status : "sampling",
      consecutiveWins: Number(ci.consecutive_wins ?? 0) || 0,
      totalLosses: Number(ci.total_losses ?? 0) || 0,
      consecutiveLosses: Number(ci.consecutive_losses ?? 0) || 0,
      checkpointsPassed: Number(ci.checkpoints_passed ?? 0) || 0,
    };
  });
}

function sortKey(m: RankedMiner): number[] {
  if (m.isChampion) return [0];
  if (m.status === "terminated") {
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
  return `${scorePercent.toFixed(2)}/${historical}`;
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
  } else if (m.status === "terminated") {
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

export function championBannerLines(
  blockNumber: number,
  championState: ChampionState | null,
  miners: RankedMiner[]
): string {
  const championPresentUid = miners.find((m) => m.isChampion)?.uid ?? null;
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
  return "Champion:   (none — cold start)";
}

export function footerSummary(
  miners: RankedMiner[],
  championState: ChampionState | null
): string {
  const samplingCount = miners.filter(
    (m) => m.status === "sampling" && !m.isChampion
  ).length;
  const terminatedCount = miners.filter((m) => m.status === "terminated")
    .length;
  const championPresentUid = miners.find((m) => m.isChampion)?.uid ?? null;

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

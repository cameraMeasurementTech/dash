import type {
  ChampionState,
  ConfigEnvelope,
  EnvConfig,
  ScoresLatestResponse,
  WeightsLatestResponse,
} from "./types";

type EnvMap = Record<string, EnvConfig>;

const RANK_FETCH_LIMIT = 256;

export function getApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/api/v1";
  return "https://api.affine.io/api/v1";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLatestScores(
  base: string
): Promise<ScoresLatestResponse> {
  return fetchJson<ScoresLatestResponse>(
    `${base}/scores/latest?top=${RANK_FETCH_LIMIT}`
  );
}

export async function fetchEnvironments(
  base: string
): Promise<ConfigEnvelope<Record<string, EnvConfig>>> {
  return fetchJson<ConfigEnvelope<Record<string, EnvConfig>>>(
    `${base}/config/environments`
  );
}

export async function fetchWeightsLatest(
  base: string
): Promise<WeightsLatestResponse> {
  return fetchJson<WeightsLatestResponse>(`${base}/scores/weights/latest`);
}

/** Returns null on 404 (cold start). */
export async function fetchChampionState(
  base: string
): Promise<ChampionState | null> {
  try {
    const res = await fetch(`${base}/config/champion`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as ConfigEnvelope<ChampionState>;
    const value = data.param_value;
    if (value && typeof value === "object") return value as ChampionState;
    return null;
  } catch {
    return null;
  }
}

export interface RankSnapshotBundle {
  scores: ScoresLatestResponse;
  environments: ConfigEnvelope<Record<string, EnvConfig>>;
  weights: WeightsLatestResponse;
  champion: ChampionState | null;
}

export async function fetchRankSnapshot(base: string): Promise<RankSnapshotBundle> {
  const [scores, environments, weights, champion] = await Promise.all([
    fetchLatestScores(base),
    fetchEnvironments(base).catch(() => ({} as ConfigEnvelope<EnvMap>)),
    fetchWeightsLatest(base).catch(
      () => ({ config: {} }) as WeightsLatestResponse
    ),
    fetchChampionState(base),
  ]);
  return { scores, environments, weights, champion };
}

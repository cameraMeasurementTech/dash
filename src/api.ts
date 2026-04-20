import type {
  ChampionState,
  ConfigEnvelope,
  EnvConfig,
  ScoresLatestResponse,
  WeightsLatestResponse,
} from "./types";

type EnvMap = Record<string, EnvConfig>;

const RANK_FETCH_LIMIT = 256;

/** Default v1 mirror path — browser must hit same origin; reverse-proxy to api.affine.io (see vite.config / nginx). */
const DEFAULT_API_BASE = "/api/v1";

/** Default www affine API mirror path — proxy to https://www.affine.io/api/affine */
const DEFAULT_AFFINE_SCORES_BASE = "/affine-io";

/**
 * Resolve a same-origin API base (no trailing slash). Absolute `http(s)://` URLs
 * are rejected so the client never calls upstream hosts directly.
 */
function sameOriginBase(
  fromEnv: string | undefined,
  fallback: string,
  envName: string
): string {
  const raw = fromEnv?.trim() ?? "";
  if (!raw) return fallback;
  const t = raw.replace(/\/$/, "");
  if (t.startsWith("http://") || t.startsWith("https://")) {
    if (import.meta.env.DEV) {
      console.warn(
        `[dash] ${envName} must be a same-origin path (e.g. ${fallback}), not an absolute URL. Using default.`
      );
    }
    return fallback;
  }
  return t;
}

/**
 * v1 API base (no trailing slash). Defaults to `/api/v1` (dev: Vite proxy → api.affine.io;
 * prod: configure nginx or similar). Optional `VITE_API_BASE_URL` must be a path, not `https://...`.
 */
export function getApiBaseUrl(): string {
  return sameOriginBase(
    import.meta.env.VITE_API_BASE_URL,
    DEFAULT_API_BASE,
    "VITE_API_BASE_URL"
  );
}

/**
 * Base path for www affine scores/config. Defaults to `/affine-io` (Vite / nginx → www.affine.io/api/affine).
 * Optional `VITE_AFFINE_SCORES_BASE_URL` must be a path, not an absolute URL.
 */
export function getAffineScoresBaseUrl(): string {
  return sameOriginBase(
    import.meta.env.VITE_AFFINE_SCORES_BASE_URL,
    DEFAULT_AFFINE_SCORES_BASE,
    "VITE_AFFINE_SCORES_BASE_URL"
  );
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

export async function fetchAffineScoresLatest(
  base: string
): Promise<ScoresLatestResponse> {
  return fetchJson<ScoresLatestResponse>(`${base}/scores/latest`);
}

/**
 * Global env tuning from www (same host as scores), e.g. …/system/config
 * under the proxied affine-io path.
 */
export async function fetchAffineSystemConfig(
  base: string
): Promise<ConfigEnvelope<Record<string, EnvConfig>>> {
  return fetchJson<ConfigEnvelope<Record<string, EnvConfig>>>(
    `${base}/system/config`
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

/**
 * Same read-only bundle as `af get-rank` (`affine/affine/src/miner/rank.py`):
 * parallel `GET /scores/latest?top=256`, `/config/environments`,
 * `/scores/weights/latest`, `/config/champion` against **v1** `base`.
 *
 * Dashboard uses this for **Status / CP / Challenge** (from `scores[].challenge_info`
 * + weights `champion_dethrone_min_checkpoint` / `champion_termination_total_losses`)
 * and for champion banner / footer when v1 loads.
 *
 * **Second** source (www `getAffineScoresBaseUrl()`): `fetchAffineScoresLatest`
 * (rank, avg, env metrics) and `fetchAffineSystemConfig` (`min_completeness` thresholds).
 */
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

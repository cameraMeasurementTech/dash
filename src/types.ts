export interface EnvScore {
  score?: number;
  historical_count?: number;
  sample_count?: number;
  /** 1 means full completeness for this env (UI highlights the cell). */
  completeness?: number;
}

export interface ChallengeInfo {
  is_champion?: boolean;
  status?: string;
  consecutive_wins?: number;
  total_losses?: number;
  consecutive_losses?: number;
  checkpoints_passed?: number;
}

export interface RawMinerScore {
  miner_hotkey?: string;
  uid?: number;
  model?: string;
  average_score?: number;
  rank?: number;
  weight?: number;
  scores_by_env?: Record<string, EnvScore>;
  challenge_info?: ChallengeInfo;
}

export interface ScoresLatestResponse {
  block_number: number;
  calculated_at: number;
  scores: RawMinerScore[];
}

export interface WeightsLatestResponse {
  block_number?: number;
  config: Record<string, unknown>;
  weights?: Record<string, unknown>;
}

export type EnvConfig = {
  enabled_for_scoring?: boolean;
  display_name?: string;
  /** From www system config — completeness must meet this to be “eligible”. */
  min_completeness?: number;
  [key: string]: unknown;
};

export interface ConfigEnvelope<T = unknown> {
  param_value?: T;
}

export interface ChampionState {
  hotkey?: string;
  since_block?: number | null;
  uid?: number | null;
  revision?: string;
}

export interface RankedMiner {
  uid: number;
  hotkey: string;
  /** Leaderboard rank from API when present (1 = best). */
  rank: number | null;
  model: string;
  scoresByEnv: Record<string, EnvScore>;
  averageScore: number;
  isChampion: boolean;
  status: string;
  consecutiveWins: number;
  totalLosses: number;
  consecutiveLosses: number;
  checkpointsPassed: number;
}

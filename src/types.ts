export interface EnvScore {
  score?: number;
  historical_count?: number;
  sample_count?: number;
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

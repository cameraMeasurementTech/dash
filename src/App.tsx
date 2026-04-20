import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRankSnapshot, getApiBaseUrl } from "./api";
import {
  buildRowDisplay,
  championBannerLines,
  envDisplayName,
  footerSummary,
  parseEnvironments,
  parseRankedMiners,
  readScorerConfig,
  formatIso,
  formatRelativeTime,
  sortRankedMiners,
} from "./rankLogic";
import type { ChampionState, EnvConfig, RankedMiner } from "./types";
import "./App.css";

type LoadState =
  | { kind: "idle" | "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      blockNumber: number;
      calculatedAt: number;
      miners: RankedMiner[];
      envNames: string[];
      envConfigs: Record<string, EnvConfig>;
      dethroneCp: number;
      terminationM: number;
      championState: ChampionState | null;
    };

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const baseUrl = useMemo(() => getApiBaseUrl(), []);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { scores, environments, weights, champion } =
        await fetchRankSnapshot(baseUrl);

      if (!scores?.block_number) {
        setState({ kind: "error", message: "No scores found" });
        return;
      }

      const scoresList = scores.scores ?? [];
      if (scoresList.length === 0) {
        setState({
          kind: "error",
          message: `No miners scored at block ${scores.block_number}`,
        });
        return;
      }

      const { names: envNames, configs: envConfigs } = parseEnvironments(
        environments.param_value as Record<string, EnvConfig> | undefined
      );
      const { dethroneCp, terminationLosses } = readScorerConfig(
        weights.config
      );
      const miners = sortRankedMiners(parseRankedMiners(scoresList));

      setState({
        kind: "ok",
        blockNumber: scores.block_number,
        calculatedAt: scores.calculated_at,
        miners,
        envNames,
        envConfigs,
        dethroneCp,
        terminationM: terminationLosses,
        championState: champion,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ kind: "error", message });
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = state.kind === "loading";

  return (
    <div className="app">
      <div className="header-bar">
        <h1>Champion challenge ranking</h1>
        <button
          type="button"
          className="btn"
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh
        </button>
        <span className="meta">API: {baseUrl}</span>
      </div>

      {state.kind === "loading" && (
        <p className="loading">Loading snapshot…</p>
      )}

      {state.kind === "error" && (
        <div className="error" role="alert">
          {state.message}
        </div>
      )}

      {state.kind === "ok" && (
        <>
          <div className="banner">
            <div className="banner-title">
              CHAMPION CHALLENGE RANKING — Block {state.blockNumber}
            </div>
            <p className="banner-line">
              Calculated: {formatRelativeTime(state.calculatedAt)} (
              {formatIso(state.calculatedAt)})
            </p>
            <p className="banner-line champion-line">
              {championBannerLines(
                state.blockNumber,
                state.championState,
                state.miners
              )}
            </p>
          </div>

          <div className="table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>Hotkey</th>
                  <th>UID</th>
                  <th>Model</th>
                  {state.envNames.map((env) => (
                    <th key={env} className="num">
                      {envDisplayName(env, state.envConfigs[env])}
                    </th>
                  ))}
                  <th className="status-col">Status</th>
                  <th className="num cp-col">CP</th>
                  <th className="challenge-col">Challenge</th>
                </tr>
              </thead>
              <tbody>
                {state.miners.map((m, rowIdx) => {
                  const row = buildRowDisplay(
                    m,
                    state.envNames,
                    state.dethroneCp,
                    state.terminationM
                  );
                  return (
                    <tr
                      key={`${rowIdx}-${m.uid}-${m.hotkey}`}
                      className={m.isChampion ? "champion" : undefined}
                    >
                      <td>{row.hotkey8.trimEnd()}</td>
                      <td>{m.uid}</td>
                      <td title={m.model}>{row.model25.trimEnd()}</td>
                      {row.envCells.map((cell, i) => (
                        <td key={state.envNames[i]} className="num">
                          {cell.trim()}
                        </td>
                      ))}
                      <td className="status-col">{row.statusStr}</td>
                      <td className="num cp-col">{row.cpStr}</td>
                      <td className="challenge-col">{row.challengeStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="footer">
            {footerSummary(state.miners, state.championState)}
          </footer>
        </>
      )}
    </div>
  );
}

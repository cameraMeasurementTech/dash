import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRankSnapshot, getApiBaseUrl } from "./api";
import {
  appendSnapshot,
  exportHistoryJson,
  loadSnapshots,
  seriesAveragePercent,
  seriesEnvPercent,
} from "./historyStore";
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
import { ScoreSparkline, sparkColor } from "./ScoreSparkline";
import {
  sameColumn,
  sortMinersList,
  toggleSortState,
  type SortColumn,
  type SortContext,
  type SortState,
} from "./tableSort";
import type { ChampionState, EnvConfig, RankedMiner } from "./types";
import type { HistorySnapshot } from "./historyStore";
import "./App.css";

const REFRESH_MS = 10 * 60_000;

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

function SortableTh({
  column,
  sortState,
  onToggle,
  className,
  children,
}: {
  column: SortColumn;
  sortState: SortState;
  onToggle: (c: SortColumn) => void;
  className?: string;
  children: React.ReactNode;
}) {
  let arrow = "";
  if (sortState && sameColumn(sortState.col, column)) {
    arrow = sortState.dir === "asc" ? " ▲" : " ▼";
  }
  return (
    <th
      scope="col"
      className={["sortable", className].filter(Boolean).join(" ")}
      onClick={() => onToggle(column)}
      title="Click: sort · again: reverse order · third click: reset to default order"
    >
      {children}
      <span className="sort-indicator">{arrow}</span>
    </th>
  );
}

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>(() =>
    loadSnapshots()
  );
  const [showTerminated, setShowTerminated] = useState(true);
  const [sortState, setSortState] = useState<SortState>(null);
  const baseUrl = useMemo(() => getApiBaseUrl(), []);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const myId = ++reqIdRef.current;
      if (!silent) setState({ kind: "loading" });
      try {
        const { scores, environments, weights, champion } =
          await fetchRankSnapshot(baseUrl);

        if (myId !== reqIdRef.current) return;

        if (!scores?.block_number) {
          if (!silent) setState({ kind: "error", message: "No scores found" });
          return;
        }

        const scoresList = scores.scores ?? [];
        if (scoresList.length === 0) {
          if (!silent) {
            setState({
              kind: "error",
              message: `No miners scored at block ${scores.block_number}`,
            });
          }
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

        const next = appendSnapshot({
          blockNumber: scores.block_number,
          calculatedAt: scores.calculated_at,
          envNames,
          miners: miners.map((m) => ({
            uid: m.uid,
            hotkey: m.hotkey,
            model: m.model,
            averageScore: m.averageScore,
            scoresByEnv: Object.fromEntries(
              Object.entries(m.scoresByEnv).map(([k, v]) => [
                k,
                {
                  score: v.score,
                  historical_count: v.historical_count,
                  sample_count: v.sample_count,
                },
              ])
            ),
          })),
        });
        setSnapshots(next);
      } catch (e) {
        if (myId !== reqIdRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        if (!silent) setState({ kind: "error", message });
      }
    },
    [baseUrl]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const downloadHistory = useCallback(() => {
    const blob = new Blob([exportHistoryJson()], {
      type: "application/json",
    });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `affine-rank-history-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const handleSort = useCallback((col: SortColumn) => {
    setSortState((prev) => toggleSortState(prev, col));
  }, []);

  const busy = state.kind === "loading";

  const visibleMiners = useMemo(() => {
    if (state.kind !== "ok") return [];
    if (showTerminated) return state.miners;
    return state.miners.filter((m) => m.status !== "terminated");
  }, [state, showTerminated]);

  const sortCtx: SortContext | null = useMemo(() => {
    if (state.kind !== "ok") return null;
    return {
      envNames: state.envNames,
      dethroneCp: state.dethroneCp,
      terminationM: state.terminationM,
    };
  }, [state]);

  const displayedMiners = useMemo(() => {
    if (!sortCtx) return [];
    return sortMinersList(visibleMiners, sortState, sortCtx);
  }, [visibleMiners, sortState, sortCtx]);

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
        <button
          type="button"
          className="btn"
          onClick={downloadHistory}
          disabled={snapshots.length === 0}
        >
          Export history JSON
        </button>
        <span className="meta">API: {baseUrl}</span>
        <span className="meta">Auto-refresh: 10m · History points: {snapshots.length}</span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showTerminated}
            onChange={(e) => setShowTerminated(e.target.checked)}
          />
          Show TERMINATED
        </label>
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
            {!showTerminated && (
              <p className="banner-line filter-note">
                Table: {visibleMiners.length} of {state.miners.length} miners
                (TERMINATED hidden)
              </p>
            )}
          </div>

          <div className="table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <SortableTh
                    column={{ kind: "hotkey" }}
                    sortState={sortState}
                    onToggle={handleSort}
                  >
                    Hotkey
                  </SortableTh>
                  <SortableTh
                    column={{ kind: "uid" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="num"
                  >
                    UID
                  </SortableTh>
                  <SortableTh
                    column={{ kind: "model" }}
                    sortState={sortState}
                    onToggle={handleSort}
                  >
                    Model
                  </SortableTh>
                  <SortableTh
                    column={{ kind: "avg" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="num score-col-header"
                  >
                    Avg
                  </SortableTh>
                  {state.envNames.map((env) => (
                    <SortableTh
                      key={env}
                      column={{ kind: "env", env }}
                      sortState={sortState}
                      onToggle={handleSort}
                      className="num score-col-header"
                    >
                      {envDisplayName(env, state.envConfigs[env])}
                    </SortableTh>
                  ))}
                  <SortableTh
                    column={{ kind: "status" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="status-col"
                  >
                    Status
                  </SortableTh>
                  <SortableTh
                    column={{ kind: "cp" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="num cp-col"
                  >
                    CP
                  </SortableTh>
                  <SortableTh
                    column={{ kind: "challenge" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="challenge-col"
                  >
                    Challenge
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {displayedMiners.map((m, rowIdx) => {
                  const row = buildRowDisplay(
                    m,
                    state.envNames,
                    state.dethroneCp,
                    state.terminationM
                  );
                  const avgPct = (m.averageScore * 100).toFixed(2);
                  const avgColorIdx = state.envNames.length;
                  return (
                    <tr
                      key={`${rowIdx}-${m.uid}-${m.hotkey}`}
                      className={m.isChampion ? "champion" : undefined}
                    >
                      <td>{row.hotkey8.trimEnd()}</td>
                      <td className="num">{m.uid}</td>
                      <td className="model-cell">
                        {m.model.trim() ? (
                          <a
                            className="model-link"
                            href={`https://huggingface.co/${m.model.trim().replace(/^\/+/, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${m.model} — open on Hugging Face`}
                          >
                            {row.model25.trimEnd()}
                          </a>
                        ) : (
                          row.model25.trimEnd()
                        )}
                      </td>
                      <td className="num score-cell">
                        <div className="score-cell-stack">
                          <div className="score-cell-value">{avgPct}</div>
                          <ScoreSparkline
                            data={seriesAveragePercent(snapshots, m.uid)}
                            color={sparkColor(avgColorIdx)}
                          />
                        </div>
                      </td>
                      {state.envNames.map((env, i) => (
                        <td
                          key={env}
                          className="num score-cell"
                        >
                          <div className="score-cell-stack">
                            <div className="score-cell-value">
                              {row.envCells[i]?.trim() ?? "—"}
                            </div>
                            <ScoreSparkline
                              data={seriesEnvPercent(snapshots, m.uid, env)}
                              color={sparkColor(i)}
                            />
                          </div>
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

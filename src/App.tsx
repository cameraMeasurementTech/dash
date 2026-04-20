import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAffineScoresLatest,
  fetchAffineSystemConfig,
  fetchRankSnapshot,
  getAffineScoresBaseUrl,
  getApiBaseUrl,
} from "./api";
import {
  appendSnapshot,
  exportHistoryJson,
  loadSnapshots,
  seriesAveragePercent,
  seriesEnvPercent,
} from "./historyStore";
import {
  buildChallengeColumnDisplay,
  championBannerLines,
  envDisplayName,
  envCompletenessMeetsMin,
  fractionToPercentDisplay,
  footerSummary,
  inferEnvNamesFromMiners,
  isTerminatedStatus,
  parseMinCompletenessByEnv,
  scoresListHasChallengeInfo,
  mergeWwwScoresOntoLegacy,
  filterEnvNamesWithNonZeroScores,
  parseEnvironments,
  parseRankedMiners,
  readScorerConfig,
  sortRankedMiners,
  challengeMinerForDisplay,
  formatIso,
  formatRelativeTime,
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
      /** Per-env floor from https://www.affine.io/api/affine/system/config */
      minCompletenessByEnv: Record<string, number>;
      dethroneCp: number;
      terminationM: number;
      championState: ChampionState | null;
      /**
       * Parsed from v1 `GET /scores/latest` when available. Status / CP / Challenge
       * use this when present; www public scores omit `challenge_info`, so v1 is required
       * for those columns (see `challengeInfoAvailable`).
       */
      v1ChallengeMiners: RankedMiner[] | null;
      /**
       * v1 (and `af get-rank`) include `challenge_info` on each miner. The public
       * www `scores/latest` currently does not — those columns show "—" when false.
       */
      challengeInfoAvailable: boolean;
      /** Which snapshot supplied table row order and env overlay (www when v1 was unavailable). */
      scoresSource: "legacy" | "www";
    };

function SortableTh({
  column,
  sortState,
  onToggle,
  className,
  title: headerTitle,
  children,
}: {
  column: SortColumn;
  sortState: SortState;
  onToggle: (c: SortColumn) => void;
  className?: string;
  /** Extra header tooltip (prepended to sort hint). */
  title?: string;
  children: React.ReactNode;
}) {
  let arrow = "";
  if (sortState && sameColumn(sortState.col, column)) {
    arrow = sortState.dir === "asc" ? " ▲" : " ▼";
  }
  const sortHint =
    "Click: sort · again: reverse order · third click: reset to default order";
  const title =
    headerTitle && headerTitle.length > 0
      ? `${headerTitle} · ${sortHint}`
      : sortHint;
  return (
    <th
      scope="col"
      className={["sortable", className].filter(Boolean).join(" ")}
      onClick={() => onToggle(column)}
      title={title}
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
  const scoresApiBase = useMemo(() => getAffineScoresBaseUrl(), []);
  const apiBase = useMemo(() => getApiBaseUrl(), []);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const myId = ++reqIdRef.current;
      if (!silent) setState({ kind: "loading" });
      try {
        let miners: RankedMiner[];
        let blockNumber: number;
        let calculatedAt: number;
        let scoresSource: "legacy" | "www";
        let rankSnap: Awaited<ReturnType<typeof fetchRankSnapshot>> | null =
          null;
        let v1ChallengeMiners: RankedMiner[] | null = null;

        /** API 1 — v1 bundle (same-origin `/api/v1` → reverse proxy). */
        const [snap, wwwScores, systemConfig] = await Promise.all([
          fetchRankSnapshot(apiBase).catch(() => null),
          /** API 2 — www leaderboard / env metrics overlay. */
          fetchAffineScoresLatest(scoresApiBase).catch(() => null),
          /** API 2b — www env thresholds (min_completeness). */
          fetchAffineSystemConfig(scoresApiBase).catch(() => null),
        ]);
        rankSnap = snap;
        if (myId !== reqIdRef.current) return;

        const legacyScores = rankSnap?.scores;
        const legacyList = legacyScores?.scores ?? [];
        const legacyOk =
          Boolean(legacyScores?.block_number) && legacyList.length > 0;

        const wwwList = wwwScores?.scores ?? [];
        const wwwOk =
          Boolean(wwwScores?.block_number) && wwwList.length > 0;

        const challengeInfoAvailable =
          legacyOk ||
          (wwwOk && scoresListHasChallengeInfo(wwwList));

        if (!legacyOk && !wwwOk) {
          if (!silent) {
            setState({
              kind: "error",
              message:
                "Could not load scores via same-origin /api/v1 or /affine-io. " +
                "Use `npm run dev` (Vite proxies both paths) or deploy behind nginx " +
                "that proxies /api/ and /affine-io/ to Affine (see deploy/nginx-affine-dashboard.example.conf). " +
                "Optional: set VITE_API_BASE_URL and VITE_AFFINE_SCORES_BASE_URL to other **path** bases.",
            });
          }
          return;
        }

        if (legacyOk) {
          const legacyParsed = parseRankedMiners(legacyList);
          v1ChallengeMiners = legacyParsed;
          const sortedLegacy = sortRankedMiners(legacyParsed);
          if (wwwOk) {
            miners = mergeWwwScoresOntoLegacy(sortedLegacy, wwwList);
          } else {
            miners = sortedLegacy;
          }
          blockNumber = legacyScores!.block_number;
          calculatedAt = legacyScores!.calculated_at;
          scoresSource = "legacy";
        } else {
          const sortedWww = [...wwwList].sort((a, b) => {
            const ra =
              typeof a.rank === "number" ? a.rank : Number.POSITIVE_INFINITY;
            const rb =
              typeof b.rank === "number" ? b.rank : Number.POSITIVE_INFINITY;
            if (ra !== rb) return ra - rb;
            return (b.average_score ?? 0) - (a.average_score ?? 0);
          });
          miners = parseRankedMiners(sortedWww);
          v1ChallengeMiners = null;
          blockNumber = wwwScores!.block_number;
          calculatedAt = wwwScores!.calculated_at;
          scoresSource = "www";
        }

        const { names: configEnvNames, configs: envConfigs } = parseEnvironments(
          rankSnap?.environments?.param_value as
            | Record<string, EnvConfig>
            | undefined
        );
        const envNamesRaw =
          configEnvNames.length > 0
            ? configEnvNames
            : inferEnvNamesFromMiners(miners);
        const envNames = filterEnvNamesWithNonZeroScores(miners, envNamesRaw);
        const minCompletenessByEnv = parseMinCompletenessByEnv(
          systemConfig?.param_value as Record<string, EnvConfig> | undefined
        );
        const { dethroneCp, terminationLosses } = readScorerConfig(
          legacyOk ? rankSnap?.weights?.config : undefined
        );

        setState({
          kind: "ok",
          blockNumber,
          calculatedAt,
          miners,
          envNames,
          envConfigs,
          minCompletenessByEnv,
          dethroneCp,
          terminationM: terminationLosses,
          championState: rankSnap?.champion ?? null,
          v1ChallengeMiners,
          challengeInfoAvailable,
          scoresSource,
        });

        const next = appendSnapshot({
          blockNumber,
          calculatedAt,
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
    [scoresApiBase, apiBase]
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
    if (!state.challengeInfoAvailable) return state.miners;
    const v1 = state.v1ChallengeMiners;
    return state.miners.filter((m) => {
      const row = challengeMinerForDisplay(m, v1);
      return !isTerminatedStatus(row.status);
    });
  }, [state, showTerminated]);

  const sortCtx: SortContext | null = useMemo(() => {
    if (state.kind !== "ok") return null;
    return {
      envNames: state.envNames,
      dethroneCp: state.dethroneCp,
      terminationM: state.terminationM,
      v1ChallengeMiners: state.v1ChallengeMiners,
      challengeInfoAvailable: state.challengeInfoAvailable,
    };
  }, [state]);

  const displayedMiners = useMemo(() => {
    if (!sortCtx) return [];
    return sortMinersList(visibleMiners, sortState, sortCtx);
  }, [visibleMiners, sortState, sortCtx]);

  return (
    <div className="app">
      <div className="header-bar">
        <h1>Affine miner scores</h1>
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
        <span className="meta">API 1 (v1): {apiBase}</span>
        <span className="meta">
          API 2 (rank / env overlay): {scoresApiBase}
        </span>
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
              Affine scores — Block {state.blockNumber}
            </div>
            <p className="banner-line">
              Calculated: {formatRelativeTime(state.calculatedAt)} (
              {formatIso(state.calculatedAt)})
            </p>
            <p className="banner-line champion-line">
              {championBannerLines(
                state.blockNumber,
                state.championState,
                state.miners,
                state.v1ChallengeMiners,
                state.challengeInfoAvailable
              )}
            </p>
            {state.scoresSource === "www" && (
              <p className="banner-line filter-note">
                Rows from www <code>scores/latest</code> only — v1 at{" "}
                <code>{apiBase}</code> was not reachable (proxy or nginx must
                forward that path to api.affine.io). The www scores feed does
                not ship <code>challenge_info</code>, so Status / CP / Challenge
                are “—”. Champion line cannot match <code>af get-rank</code>{" "}
                without v1 <code>/scores/latest</code> and{" "}
                <code>/config/champion</code>.
              </p>
            )}
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
                    column={{ kind: "rank" }}
                    sortState={sortState}
                    onToggle={handleSort}
                    className="num"
                  >
                    Rank
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
                  {state.envNames.map((env) => {
                    const minC = state.minCompletenessByEnv[env];
                    const minTitle =
                      typeof minC === "number" && Number.isFinite(minC)
                        ? `min_completeness: ${fractionToPercentDisplay(minC, 1)} (green when completeness ≥ this; www system/config)`
                        : "min_completeness: — (www system/config unavailable for this env)";
                    return (
                      <SortableTh
                        key={env}
                        column={{ kind: "env", env }}
                        sortState={sortState}
                        onToggle={handleSort}
                        className="num score-col-header"
                        title={minTitle}
                      >
                        {envDisplayName(env, state.envConfigs[env])}
                      </SortableTh>
                    );
                  })}
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
                  const rowChallenge = buildChallengeColumnDisplay(
                    m,
                    state.v1ChallengeMiners,
                    state.envNames,
                    state.dethroneCp,
                    state.terminationM,
                    state.challengeInfoAvailable
                  );
                  const model25 = (m.model || "")
                    .slice(0, 25)
                    .padEnd(25, " ");
                  const avgColorIdx = state.envNames.length;
                  return (
                    <tr
                      key={`${rowIdx}-${m.hotkey || "empty"}-${m.uid}`}
                      className={
                        rowChallenge.isChampion ? "champion" : undefined
                      }
                    >
                      <td className="num">
                        {typeof m.rank === "number" && Number.isFinite(m.rank)
                          ? m.rank
                          : "—"}
                      </td>
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
                            {model25.trimEnd()}
                          </a>
                        ) : (
                          model25.trimEnd()
                        )}
                      </td>
                      <td className="num score-cell">
                        <div className="score-cell-stack">
                          <div className="score-cell-value">
                            {fractionToPercentDisplay(m.averageScore)}
                          </div>
                          <ScoreSparkline
                            data={seriesAveragePercent(snapshots, m.uid)}
                            color={sparkColor(avgColorIdx)}
                          />
                        </div>
                      </td>
                      {state.envNames.map((env, i) => {
                        const envData = m.scoresByEnv[env];
                        const minReq = state.minCompletenessByEnv[env];
                        const eligible = envCompletenessMeetsMin(
                          envData?.completeness,
                          minReq
                        );
                        return (
                          <td key={env} className="num score-cell">
                            <div className="score-cell-stack">
                              <div
                                className={[
                                  "env-metrics",
                                  eligible ? "env-metrics--eligible" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              >
                                <div className="env-metric-line">
                                  <span className="env-metric-key">
                                    min_completeness
                                  </span>
                                  :{" "}
                                  {fractionToPercentDisplay(minReq, 1)}
                                </div>
                                {envData ? (
                                  <>
                                    <div className="env-metric-line">
                                      <span className="env-metric-key">
                                        score
                                      </span>
                                      :{" "}
                                      {fractionToPercentDisplay(
                                        envData.score
                                      )}
                                    </div>
                                    <div className="env-metric-line">
                                      <span className="env-metric-key">
                                        sample_count
                                      </span>
                                      :{" "}
                                      {typeof envData.sample_count === "number"
                                        ? envData.sample_count
                                        : "—"}
                                    </div>
                                    <div className="env-metric-line">
                                      <span className="env-metric-key">
                                        completeness
                                      </span>
                                      :{" "}
                                      {fractionToPercentDisplay(
                                        envData.completeness,
                                        1
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="env-metric-missing">
                                    no env row
                                  </span>
                                )}
                              </div>
                              <ScoreSparkline
                                data={seriesEnvPercent(snapshots, m.uid, env)}
                                color={sparkColor(i)}
                              />
                            </div>
                          </td>
                        );
                      })}
                      <td className="status-col">{rowChallenge.statusStr}</td>
                      <td className="num cp-col">{rowChallenge.cpStr}</td>
                      <td className="challenge-col">
                        {rowChallenge.challengeStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="footer">
            {footerSummary(
              state.miners,
              state.championState,
              state.v1ChallengeMiners,
              state.challengeInfoAvailable
            )}
          </footer>
        </>
      )}
    </div>
  );
}

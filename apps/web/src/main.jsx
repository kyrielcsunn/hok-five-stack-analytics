import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const sides = ["blue", "red"];
const results = ["win", "loss"];
const lanes = ["对抗路", "中路", "打野", "发育路", "游走"];
const laneSources = ["medal", "manual", "hero_default", "manual_guess"];
const laneConfidences = ["high", "medium", "low"];
const statSwitches = [
  ["include_in_personal_stats", "个人统计"],
  ["include_in_pair_stats", "组合统计"],
  ["include_in_lineup_stats", "五排阵容"],
  ["include_in_for_fun_stats", "娱乐榜"],
];

const statusLabel = {
  checking: "检测中",
  ready: "API 已连接",
  offline: "API 未启动",
  error: "API 异常",
};

const reviewStatusLabel = {
  pending_pairing: "待配图",
  pending_review: "待审核",
  approved: "已批准",
  rejected: "已拒绝",
  imported: "已入库",
};

const resultLabel = {
  win: "胜",
  loss: "负",
};

function isReviewableStatus(status) {
  return status === "pending_pairing" || status === "pending_review";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultStatInclusion(players) {
  const friendCount = players.filter((player) => player.is_friend_candidate).length;

  if (friendCount >= 5) {
    return {
      include_in_personal_stats: true,
      include_in_pair_stats: true,
      include_in_lineup_stats: true,
      include_in_for_fun_stats: true,
      exclude_reason: null,
    };
  }

  if (friendCount === 4) {
    return {
      include_in_personal_stats: true,
      include_in_pair_stats: true,
      include_in_lineup_stats: false,
      include_in_for_fun_stats: true,
      exclude_reason: "4+1 局，不纳入五排阵容",
    };
  }

  return {
    include_in_personal_stats: false,
    include_in_pair_stats: false,
    include_in_lineup_stats: false,
    include_in_for_fun_stats: false,
    exclude_reason: "朋友队人数不足",
  };
}

function normalizeDraftForEditor(normalizedJson) {
  const draft = cloneJson(normalizedJson);
  const defaultStats = getDefaultStatInclusion(draft.players ?? []);

  draft.match = {
    ...draft.match,
  };

  for (const [field] of statSwitches) {
    if (typeof draft.match[field] !== "boolean") {
      draft.match[field] = defaultStats[field];
    }
  }

  if (!Object.hasOwn(draft.match, "exclude_reason")) {
    draft.match.exclude_reason = defaultStats.exclude_reason;
  }

  return draft;
}

function toNullableText(value) {
  const trimmed = String(value ?? "").trim();

  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value) {
  if (value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function toNullableInteger(value) {
  const number = toNullableNumber(value);

  return number === null ? null : Math.trunc(number);
}

function splitMedals(value) {
  return String(value ?? "")
    .split(/[、,，]/)
    .map((medal) => medal.trim())
    .filter(Boolean);
}

function formatDateTime(value) {
  if (!value) {
    return "待确认";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isInteger(seconds)) {
    return "待确认";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function formatPercent(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

function formatMetric(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return Number(value).toFixed(digits);
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatFullDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function trustedWinRate(wins, games) {
  if (!games) {
    return null;
  }

  return (wins + 3) / (games + 6);
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value));

  if (validValues.length === 0) {
    return null;
  }

  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function useRoute() {
  const [route, setRoute] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    function handleRouteChange() {
      setRoute({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    }

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hok:navigation", handleRouteChange);

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hok:navigation", handleRouteChange);
    };
  }, []);

  function navigate(path) {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new Event("hok:navigation"));
  }

  return [route, navigate];
}

function useStaticExport() {
  const [state, setState] = useState({
    data: null,
    error: "",
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStaticExport() {
      try {
        // 不带 cache: no-store，让 <link rel="preload"> 能被 fetch 命中复用；
        // Vercel 已在响应头里返回 must-revalidate，浏览器仍会做条件请求，不会读到陈旧数据。
        // BASE_URL 末尾带斜杠：本地/Vercel 是 "/"，GitHub Pages 是 "/hok-five-stack-analytics/"。
        const response = await fetch(`${import.meta.env.BASE_URL}export/report-data.json`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!cancelled) {
          setState({
            data,
            error: "",
            status: "ready",
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            data: null,
            error: "未找到静态导出数据。",
            status: "error",
          });
        }
      }
    }

    loadStaticExport();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function summarizeReviewMatch(reviewMatch) {
  const normalizedJson = reviewMatch.normalized_json ?? {};
  const match = normalizedJson.match ?? {};
  const players = normalizedJson.players ?? [];
  const friendCount = players.filter((player) => player.is_friend_candidate).length;

  return {
    id: reviewMatch.id,
    batch_id: reviewMatch.batch_id,
    local_match_no: reviewMatch.local_match_no,
    status: reviewMatch.status,
    played_at: match.played_at ?? null,
    mode: match.mode ?? null,
    friend_result: match.friend_result ?? null,
    friend_side: match.friend_side ?? null,
    score:
      match.blue_score === null || match.red_score === null
        ? null
        : `${match.blue_score}:${match.red_score}`,
    friend_count: friendCount,
    updated_at: reviewMatch.updated_at,
  };
}

function summarizeImportedMatch(match) {
  return {
    id: match.id,
    batch_id: match.batch_id,
    local_match_no: match.local_match_no,
    status: match.status ?? "imported",
    played_at: match.played_at ?? null,
    mode: match.mode ?? null,
    friend_result: match.friend_result ?? null,
    friend_side: match.friend_side ?? null,
    score: match.score ?? `${match.blue_score}:${match.red_score}`,
    friend_count: match.friend_count,
    updated_at: match.updated_at,
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error ?? `HTTP ${response.status}`);

    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function useApi() {
  const [apiState, setApiState] = useState("checking");
  const [reviewMatches, setReviewMatches] = useState([]);
  const [importedMatches, setImportedMatches] = useState([]);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [selectedImportedId, setSelectedImportedId] = useState(null);
  const [selectedReviewMatch, setSelectedReviewMatch] = useState(null);
  const [selectedImportedMatch, setSelectedImportedMatch] = useState(null);
  const [friends, setFriends] = useState([]);
  const [heroes, setHeroes] = useState([]);
  const [error, setError] = useState("");
  const [isLoadingReviewDetail, setIsLoadingReviewDetail] = useState(false);
  const [isLoadingImportedDetail, setIsLoadingImportedDetail] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // 非 localhost（生产朋友站）跳过本地 API 探测：Vercel 上没有后端，
    // 探测注定失败，徒增手机端首屏请求和潜在 promise 抖动。
    if (typeof window !== "undefined" && !isLocalHostname(window.location.hostname)) {
      setApiState("offline");
      return () => {};
    }

    async function loadBootstrap() {
      try {
        const health = await fetchJson("/api/health");

        if (!health.ok) {
          throw new Error("API health check failed");
        }

        const [queue, importedData, friendData, heroData] = await Promise.all([
          fetchJson("/api/review-matches"),
          fetchJson("/api/matches"),
          fetchJson("/api/friends"),
          fetchJson("/api/heroes"),
        ]);

        if (!cancelled) {
          const matches = queue.review_matches ?? [];
          const imported = importedData.matches ?? [];

          setApiState("ready");
          setReviewMatches(matches);
          setImportedMatches(imported);
          setFriends(friendData.friends ?? []);
          setHeroes(heroData.heroes ?? []);
          setSelectedReviewId(
            (currentId) =>
              currentId ?? matches.find((match) => isReviewableStatus(match.status))?.id ?? null,
          );
          setSelectedImportedId((currentId) => currentId ?? imported[0]?.id ?? null);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setApiState("offline");
          setError("本地 API 未启动，或还没有可读取的待审数据。");
        }
      }
    }

    loadBootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selectedReviewId) {
        setSelectedReviewMatch(null);
        return;
      }

      setIsLoadingReviewDetail(true);

      try {
        const data = await fetchJson(`/api/review-matches/${encodeURIComponent(selectedReviewId)}`);

        if (!cancelled) {
          setSelectedReviewMatch(data.review_match);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setSelectedReviewMatch(null);
          setError("无法读取当前待审局详情。");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingReviewDetail(false);
        }
      }
    }

    loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedReviewId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selectedImportedId) {
        setSelectedImportedMatch(null);
        return;
      }

      setIsLoadingImportedDetail(true);

      try {
        const data = await fetchJson(`/api/matches/${encodeURIComponent(selectedImportedId)}`);

        if (!cancelled) {
          setSelectedImportedMatch(data.match);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setSelectedImportedMatch(null);
          setError("无法读取当前已入库局详情。");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingImportedDetail(false);
        }
      }
    }

    loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedImportedId]);

  async function saveDraft(id, normalizedJson) {
    const data = await fetchJson(`/api/review-matches/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        normalized_json: normalizedJson,
      }),
    });
    const savedMatch = data.review_match;

    setSelectedReviewMatch(savedMatch);
    setReviewMatches((currentMatches) =>
      currentMatches.map((reviewMatch) =>
        reviewMatch.id === savedMatch.id ? summarizeReviewMatch(savedMatch) : reviewMatch,
      ),
    );

    return savedMatch;
  }

  async function saveImportedMatch(id, normalizedJson) {
    const data = await fetchJson(`/api/matches/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        normalized_json: normalizedJson,
      }),
    });
    const savedMatch = data.match;

    setSelectedImportedMatch(savedMatch);
    setImportedMatches((currentMatches) =>
      currentMatches.map((match) =>
        match.id === savedMatch.id ? summarizeImportedMatch(savedMatch) : match,
      ),
    );

    return savedMatch;
  }

  async function runReviewAction(id, action, body) {
    const data = await fetchJson(`/api/review-matches/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: body
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const updatedMatch = data.review_match;

    setSelectedReviewMatch(updatedMatch);
    setReviewMatches((currentMatches) =>
      currentMatches.map((reviewMatch) =>
        reviewMatch.id === updatedMatch.id ? summarizeReviewMatch(updatedMatch) : reviewMatch,
      ),
    );

    if (action === "approve" && data.match_id) {
      const importedData = await fetchJson("/api/matches");

      setImportedMatches(importedData.matches ?? []);
      setSelectedImportedId((currentId) => currentId ?? data.match_id);
    }

    return data;
  }

  async function updateExistingMatch(reviewMatchId, matchId) {
    const data = await fetchJson(
      `/api/review-matches/${encodeURIComponent(reviewMatchId)}/update-existing`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          match_id: matchId,
        }),
      },
    );

    setSelectedReviewMatch(data.review_match);
    setReviewMatches((currentMatches) =>
      currentMatches.map((reviewMatch) =>
        reviewMatch.id === data.review_match.id ? summarizeReviewMatch(data.review_match) : reviewMatch,
      ),
    );
    setSelectedImportedMatch(data.match);
    setImportedMatches((currentMatches) =>
      currentMatches.map((match) =>
        match.id === data.match.id ? summarizeImportedMatch(data.match) : match,
      ),
    );

    return data;
  }

  return {
    approveMatch: (id, options) => runReviewAction(id, "approve", options),
    apiState,
    error,
    friends,
    heroes,
    importedMatches,
    isLoadingImportedDetail,
    isLoadingReviewDetail,
    rejectMatch: (id) => runReviewAction(id, "reject"),
    reviewMatches,
    saveImportedMatch,
    saveDraft,
    selectedImportedId,
    selectedImportedMatch,
    selectedReviewId,
    selectedReviewMatch,
    setSelectedImportedId,
    setSelectedReviewId,
    updateExistingMatch,
  };
}

function ConflictPanel({
  dedupeConflict,
  overrideReason,
  onForceApprove,
  onReasonChange,
  onUpdateExisting,
  isBusy,
}) {
  if (!dedupeConflict) {
    return null;
  }

  return (
    <section className="conflict-panel" aria-label="重复冲突">
      <div>
        <p className="eyebrow">Dedupe</p>
        <h2>发现疑似重复局</h2>
      </div>
      <p>
        去重指纹：<strong>{dedupeConflict.dedupe_key}</strong>
      </p>
      <ul>
        {dedupeConflict.conflicts.map((conflict) => (
          <li key={conflict.match_id}>
            <div>
              <strong>{conflict.type === "exact" ? "完全重复" : "疑似重复"}</strong>
              <span>
                {conflict.match_id} · {formatDateTime(conflict.played_at)} · {conflict.score} ·{" "}
                {resultLabel[conflict.friend_result] ?? conflict.friend_result}
              </span>
              <small>{conflict.reasons.join("、")}</small>
            </div>
            <button
              className="secondary-action conflict-update-action"
              disabled={isBusy}
              onClick={() => onUpdateExisting(conflict.match_id)}
              type="button"
            >
              用当前数据修正
            </button>
          </li>
        ))}
      </ul>
      <label className="field-control">
        <span>强制导入原因</span>
        <input
          value={overrideReason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="例如：同一批截图中确认为两局相似对局"
        />
      </label>
      <button
        className="primary-action"
        disabled={isBusy || overrideReason.trim().length === 0}
        onClick={onForceApprove}
        type="button"
      >
        {isBusy ? "强制导入中" : "强制导入"}
      </button>
    </section>
  );
}

function QueueList({ emptyText, emptyTitle, items, selectedId, onSelect }) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <strong>{emptyTitle}</strong>
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <nav className="queue-list" aria-label="待审对局">
      {items.map((reviewMatch) => (
        <button
          className={`queue-item ${selectedId === reviewMatch.id ? "queue-item-active" : ""}`}
          key={reviewMatch.id}
          onClick={() => onSelect(reviewMatch.id)}
          type="button"
        >
          <span className="queue-main">
            <span className="queue-no">{reviewMatch.local_match_no}</span>
            <span>
              <strong>{formatDateTime(reviewMatch.played_at)}</strong>
              <small>
                {reviewMatch.mode ?? "模式待确认"} · {reviewMatch.score ?? "比分待确认"}
              </small>
            </span>
          </span>
          <span className={`result-pill result-${reviewMatch.friend_result ?? "unknown"}`}>
            {resultLabel[reviewMatch.friend_result] ?? "待"}
          </span>
        </button>
      ))}
    </nav>
  );
}

function TextInput({ label, value, onChange }) {
  return (
    <label className="field-control">
      <span>{label}</span>
      <input value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberInput({ label, value, onChange, step = "1" }) {
  return (
    <label className="field-control">
      <span>{label}</span>
      <input
        inputMode="decimal"
        step={step}
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectControl({ label, value, onChange, options }) {
  return (
    <label className="field-control">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">待确认</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxControl({ checked, label, onChange }) {
  return (
    <label className="checkbox-control">
      <input
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function MatchEditor({ draft, onMatchFieldChange }) {
  const match = draft.match;

  return (
    <section className="editor-section" aria-label="基础对局信息">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Match</p>
          <h2>基础信息</h2>
        </div>
      </div>

      <div className="match-form">
        <TextInput label="模式" value={match.mode} onChange={(value) => onMatchFieldChange("mode", toNullableText(value))} />
        <TextInput
          label="对局时间"
          value={match.played_at}
          onChange={(value) => onMatchFieldChange("played_at", toNullableText(value))}
        />
        <NumberInput
          label="时长秒"
          value={match.duration_seconds}
          onChange={(value) => onMatchFieldChange("duration_seconds", toNullableInteger(value))}
        />
        <NumberInput
          label="蓝方击杀"
          value={match.blue_score}
          onChange={(value) => onMatchFieldChange("blue_score", toNullableInteger(value))}
        />
        <NumberInput
          label="红方击杀"
          value={match.red_score}
          onChange={(value) => onMatchFieldChange("red_score", toNullableInteger(value))}
        />
        <SelectControl
          label="胜方"
          options={sides.map((side) => ({ label: side, value: side }))}
          value={match.winner_side}
          onChange={(value) => onMatchFieldChange("winner_side", value)}
        />
        <SelectControl
          label="朋友队"
          options={sides.map((side) => ({ label: side, value: side }))}
          value={match.friend_side}
          onChange={(value) => onMatchFieldChange("friend_side", value)}
        />
        <SelectControl
          label="结果"
          options={results.map((result) => ({ label: resultLabel[result], value: result }))}
          value={match.friend_result}
          onChange={(value) => onMatchFieldChange("friend_result", value)}
        />
        {statSwitches.map(([field, label]) => (
          <CheckboxControl
            checked={match[field]}
            key={field}
            label={label}
            onChange={(value) => onMatchFieldChange(field, value)}
          />
        ))}
        <TextInput
          label="排除原因"
          value={match.exclude_reason}
          onChange={(value) => onMatchFieldChange("exclude_reason", toNullableText(value))}
        />
      </div>
    </section>
  );
}

function MetricStrip({ draft }) {
  const match = draft.match;
  const friendCount = draft.players.filter((player) => player.is_friend_candidate).length;

  return (
    <dl className="metric-strip">
      <div>
        <dt>时间</dt>
        <dd>{formatDateTime(match.played_at)}</dd>
      </div>
      <div>
        <dt>模式</dt>
        <dd>{match.mode ?? "待确认"}</dd>
      </div>
      <div>
        <dt>时长</dt>
        <dd>{formatDuration(match.duration_seconds)}</dd>
      </div>
      <div>
        <dt>比分</dt>
        <dd>
          {match.blue_score ?? "—"}:{match.red_score ?? "—"}
        </dd>
      </div>
      <div>
        <dt>朋友队</dt>
        <dd>{match.friend_side ?? "待确认"}</dd>
      </div>
      <div>
        <dt>人数</dt>
        <dd>{friendCount}/5</dd>
      </div>
    </dl>
  );
}

function ScreenshotPanel({ recordType, reviewMatch }) {
  const encodedId = encodeURIComponent(reviewMatch.id);
  const apiPath = recordType === "match" ? "matches" : "review-matches";
  const shots = [
    ["overview", "总览/KDA", reviewMatch.overview_path],
    ["detail", "详细数据", reviewMatch.detail_path],
  ];

  return (
    <section className="screenshot-grid" aria-label="对局截图">
      {shots.map(([type, label, localPath]) => (
        <figure className="screenshot-frame" key={type}>
          <figcaption>
            <span>{label}</span>
            <small>{localPath ?? "未配图"}</small>
          </figcaption>
          {localPath ? (
            <img
              alt={`${reviewMatch.local_match_no} ${label}`}
              src={`/api/${apiPath}/${encodedId}/screenshots/${type}`}
            />
          ) : (
            <div className="missing-shot">未找到截图</div>
          )}
        </figure>
      ))}
    </section>
  );
}

function PlayerTable({ players, friends, heroes, onPlayerChange }) {
  const friendOptions = friends.map((friend) => ({
    label: friend.display_name,
    value: friend.display_name,
  }));

  function handleHeroChange(playerIndex, value) {
    const heroText = toNullableText(value);
    const matchedHero = heroes.find(
      (hero) => hero.name === heroText || hero.id === heroText || hero.aliases?.includes(heroText),
    );

    onPlayerChange(playerIndex, {
      raw_hero: heroText,
      hero_id: matchedHero?.id ?? null,
      hero_name: matchedHero?.name ?? null,
    });
  }

  function handleFriendChange(playerIndex, value) {
    onPlayerChange(playerIndex, {
      friend_candidate: value,
      is_friend_candidate: Boolean(value),
    });
  }

  return (
    <section className="table-section" aria-label="玩家待审字段">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Players</p>
          <h2>玩家表</h2>
        </div>
        <span>{players.length} 人</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>阵营</th>
              <th>位置</th>
              <th>昵称</th>
              <th>朋友</th>
              <th>英雄</th>
              <th>分路</th>
              <th>来源</th>
              <th>置信</th>
              <th>评分</th>
              <th>KDA</th>
              <th>输出</th>
              <th>承伤</th>
              <th>参团</th>
              <th>标记</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => {
              const confidenceClass =
                player.lane_confidence === "low" || player.lane_confidence === "medium"
                  ? "needs-review"
                  : "";

              return (
                <tr
                  className={player.is_friend_candidate ? "friend-row" : ""}
                  key={`${player.side}-${player.slot}`}
                >
                  <td>{player.side}</td>
                  <td>{player.slot}</td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 昵称`}
                      className="table-input"
                      value={player.raw_name ?? ""}
                      onChange={(event) => onPlayerChange(index, { raw_name: toNullableText(event.target.value) })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`${player.side} ${player.slot} 朋友`}
                      className="table-input"
                      value={player.friend_candidate ?? ""}
                      onChange={(event) => handleFriendChange(index, event.target.value || null)}
                    >
                      <option value="">非朋友</option>
                      {friendOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 英雄`}
                      className="table-input"
                      list="hero-options"
                      value={player.hero_name ?? player.raw_hero ?? ""}
                      onChange={(event) => handleHeroChange(index, event.target.value)}
                    />
                    <small>{player.hero_name ? "已标准化" : "未标准化"}</small>
                  </td>
                  <td className={confidenceClass}>
                    <select
                      aria-label={`${player.side} ${player.slot} 分路`}
                      className="table-input"
                      value={player.lane ?? ""}
                      onChange={(event) => onPlayerChange(index, { lane: event.target.value || null })}
                    >
                      <option value="">待确认</option>
                      {lanes.map((lane) => (
                        <option key={lane} value={lane}>
                          {lane}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${player.side} ${player.slot} 分路来源`}
                      className="table-input"
                      value={player.lane_source ?? ""}
                      onChange={(event) => onPlayerChange(index, { lane_source: event.target.value || null })}
                    >
                      <option value="">待确认</option>
                      {laneSources.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={confidenceClass}>
                    <select
                      aria-label={`${player.side} ${player.slot} 置信度`}
                      className="table-input"
                      value={player.lane_confidence ?? ""}
                      onChange={(event) => onPlayerChange(index, { lane_confidence: event.target.value || null })}
                    >
                      <option value="">待确认</option>
                      {laneConfidences.map((confidence) => (
                        <option key={confidence} value={confidence}>
                          {confidence}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 评分`}
                      className="table-input table-number"
                      inputMode="decimal"
                      step="0.1"
                      type="number"
                      value={player.rating ?? ""}
                      onChange={(event) => onPlayerChange(index, { rating: toNullableNumber(event.target.value) })}
                    />
                  </td>
                  <td>
                    <div className="kda-inputs">
                      <input
                        aria-label={`${player.side} ${player.slot} 击杀`}
                        className="table-input table-number"
                        inputMode="numeric"
                        type="number"
                        value={player.kills ?? ""}
                        onChange={(event) => onPlayerChange(index, { kills: toNullableInteger(event.target.value) })}
                      />
                      <input
                        aria-label={`${player.side} ${player.slot} 死亡`}
                        className="table-input table-number"
                        inputMode="numeric"
                        type="number"
                        value={player.deaths ?? ""}
                        onChange={(event) => onPlayerChange(index, { deaths: toNullableInteger(event.target.value) })}
                      />
                      <input
                        aria-label={`${player.side} ${player.slot} 助攻`}
                        className="table-input table-number"
                        inputMode="numeric"
                        type="number"
                        value={player.assists ?? ""}
                        onChange={(event) => onPlayerChange(index, { assists: toNullableInteger(event.target.value) })}
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 输出占比`}
                      className="table-input table-number"
                      inputMode="decimal"
                      type="number"
                      value={player.damage_dealt_pct ?? ""}
                      onChange={(event) =>
                        onPlayerChange(index, { damage_dealt_pct: toNullableNumber(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 承伤占比`}
                      className="table-input table-number"
                      inputMode="decimal"
                      type="number"
                      value={player.damage_taken_pct ?? ""}
                      onChange={(event) =>
                        onPlayerChange(index, { damage_taken_pct: toNullableNumber(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 参团率`}
                      className="table-input table-number"
                      inputMode="decimal"
                      type="number"
                      value={player.participation_pct ?? ""}
                      onChange={(event) =>
                        onPlayerChange(index, { participation_pct: toNullableNumber(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${player.side} ${player.slot} 标记`}
                      className="table-input medal-input"
                      value={player.medals.join("、")}
                      onChange={(event) => onPlayerChange(index, { medals: splitMedals(event.target.value) })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <datalist id="hero-options">
        {heroes.map((hero) => (
          <option key={hero.id} value={hero.name} />
        ))}
      </datalist>
    </section>
  );
}

function DetailPane({
  friends,
  heroes,
  isLoadingDetail,
  onApproveMatch,
  onRejectMatch,
  onSaveImportedMatch,
  onSaveDraft,
  onUpdateExistingMatch,
  recordType,
  selectedMatch,
}) {
  const [draft, setDraft] = useState(null);
  const [actionState, setActionState] = useState("idle");
  const [dedupeConflict, setDedupeConflict] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setDraft(
      selectedMatch?.normalized_json ? normalizeDraftForEditor(selectedMatch.normalized_json) : null,
    );
    setActionState("idle");
    setDedupeConflict(null);
    setOverrideReason("");
    setSaveState("idle");
    setSaveMessage("");
  }, [selectedMatch?.id]);

  const isDirty = useMemo(() => {
    if (!draft || !selectedMatch?.normalized_json) {
      return false;
    }

    return JSON.stringify(draft) !== JSON.stringify(selectedMatch.normalized_json);
  }, [draft, selectedMatch]);
  const match = draft?.match ?? {};
  const title = selectedMatch
    ? `${selectedMatch.batch_id} / ${selectedMatch.local_match_no}`
    : "选择一局";
  const isReviewRecord = recordType === "review";
  const isImportedRecord = recordType === "match";
  const canSaveDraft = isReviewRecord && selectedMatch?.status === "pending_review";
  const canSaveImported = isImportedRecord;
  const canSave = canSaveDraft || canSaveImported;
  const canApprove = isReviewRecord && selectedMatch?.status === "pending_review";
  const canReject =
    isReviewRecord &&
    (selectedMatch?.status === "pending_pairing" || selectedMatch?.status === "pending_review");

  function updateMatchField(field, value) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      match: {
        ...currentDraft.match,
        [field]: value,
      },
    }));
  }

  function updatePlayer(index, changes) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      players: currentDraft.players.map((player, playerIndex) =>
        playerIndex === index
          ? {
              ...player,
              ...changes,
            }
          : player,
      ),
    }));
  }

  async function handleSave() {
    if (!selectedMatch || !draft || !isDirty) {
      return;
    }

    setSaveState("saving");
    setSaveMessage("");

    try {
      if (isImportedRecord) {
        await onSaveImportedMatch(selectedMatch.id, draft);
      } else {
        await onSaveDraft(selectedMatch.id, draft);
      }

      setSaveState("saved");
      setSaveMessage(isImportedRecord ? "正式对局已保存" : "草稿已保存");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error.message);
    }
  }

  async function saveDraftIfNeeded() {
    if (isReviewRecord && selectedMatch && draft && isDirty) {
      await onSaveDraft(selectedMatch.id, draft);
    }
  }

  async function handleApprove() {
    if (!selectedMatch || !draft || !canApprove || actionState !== "idle") {
      return;
    }

    setActionState("approving");
    setSaveMessage("");

    try {
      await saveDraftIfNeeded();
      await onApproveMatch(selectedMatch.id);
      setSaveState("saved");
      setDedupeConflict(null);
      setSaveMessage("已批准并入库");
    } catch (error) {
      if (error.status === 409 && error.payload?.dedupe) {
        setDedupeConflict(error.payload.dedupe);
        setSaveState("error");
        setSaveMessage("发现重复或疑似重复局，请拒绝本局、修正已有对局，或填写原因后强制导入。");
        return;
      }

      setSaveState("error");
      setSaveMessage(error.message);
    } finally {
      setActionState("idle");
    }
  }

  async function handleForceApprove() {
    if (
      !selectedMatch ||
      !draft ||
      !canApprove ||
      actionState !== "idle" ||
      overrideReason.trim().length === 0
    ) {
      return;
    }

    setActionState("force-approving");
    setSaveMessage("");

    try {
      await saveDraftIfNeeded();
      await onApproveMatch(selectedMatch.id, {
        dedupe_override_reason: overrideReason.trim(),
      });
      setDedupeConflict(null);
      setOverrideReason("");
      setSaveState("saved");
      setSaveMessage("已强制导入并记录原因");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error.message);
    } finally {
      setActionState("idle");
    }
  }

  async function handleReject() {
    if (!selectedMatch || !draft || !canReject || actionState !== "idle") {
      return;
    }

    setActionState("rejecting");
    setSaveMessage("");

    try {
      await saveDraftIfNeeded();
      await onRejectMatch(selectedMatch.id);
      setSaveState("saved");
      setSaveMessage("已拒绝本局");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error.message);
    } finally {
      setActionState("idle");
    }
  }

  async function handleUpdateExisting(matchId) {
    if (!selectedMatch || !draft || !canApprove || actionState !== "idle") {
      return;
    }

    setActionState("update-existing");
    setSaveMessage("");

    try {
      await saveDraftIfNeeded();
      await onUpdateExistingMatch(selectedMatch.id, matchId);
      setDedupeConflict(null);
      setSaveState("saved");
      setSaveMessage("已用当前待审数据修正已有对局，并拒绝本局");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error.message);
    } finally {
      setActionState("idle");
    }
  }

  if (isLoadingDetail) {
    return <section className="detail-empty">读取单局数据中</section>;
  }

  if (!selectedMatch || !draft) {
    return (
      <section className="detail-empty">
        {recordType === "match" ? "从左侧选择一局已入库数据。" : "从左侧选择一局待审数据。"}
      </section>
    );
  }

  return (
    <section className="detail-pane">
      <header className="detail-header">
        <div>
          <p className="eyebrow">{isImportedRecord ? "Imported match" : "Review match"}</p>
          <h1>{title}</h1>
        </div>
        <div className="detail-actions">
          <div className="detail-status">
            <span className={`result-pill result-${match.friend_result ?? "unknown"}`}>
              {resultLabel[match.friend_result] ?? "待确认"}
            </span>
            <span>{reviewStatusLabel[selectedMatch.status] ?? selectedMatch.status}</span>
            {isDirty ? <span className="draft-pill">未保存</span> : null}
          </div>
          <button
            className="primary-action"
            disabled={!canSave || !isDirty || saveState === "saving" || actionState !== "idle"}
            onClick={handleSave}
            type="button"
          >
            {saveState === "saving" ? "保存中" : isImportedRecord ? "保存正式对局" : "保存草稿"}
          </button>
          {isReviewRecord ? (
            <div className="action-buttons">
              <button
                className="secondary-action"
                disabled={!canReject || actionState !== "idle"}
                onClick={handleReject}
                type="button"
              >
                {actionState === "rejecting" ? "拒绝中" : "拒绝本局"}
              </button>
              <button
                className="primary-action"
                disabled={!canApprove || actionState !== "idle"}
                onClick={handleApprove}
                type="button"
              >
                {actionState === "approving" ? "入库中" : "批准入库"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {saveMessage ? <p className={`save-message save-${saveState}`}>{saveMessage}</p> : null}
      <ConflictPanel
        dedupeConflict={dedupeConflict}
        isBusy={actionState === "force-approving" || actionState === "update-existing"}
        onForceApprove={handleForceApprove}
        onReasonChange={setOverrideReason}
        onUpdateExisting={handleUpdateExisting}
        overrideReason={overrideReason}
      />

      <MetricStrip draft={draft} />
      <MatchEditor draft={draft} onMatchFieldChange={updateMatchField} />
      <ScreenshotPanel recordType={recordType} reviewMatch={selectedMatch} />
      <PlayerTable
        friends={friends}
        heroes={heroes}
        players={draft.players}
        onPlayerChange={updatePlayer}
      />
    </section>
  );
}

function StaticNav({ navigate, route }) {
  const activePath = route.pathname;

  return (
    <header className="friend-nav">
      <button className="brand-button" onClick={() => navigate("/")} type="button">
        王者五排战报
      </button>
      <nav aria-label="朋友站导航">
        <button
          className={activePath === "/" ? "friend-nav-active" : ""}
          onClick={() => navigate("/")}
          type="button"
        >
          战报
        </button>
        <button
          className={activePath === "/database" ? "friend-nav-active" : ""}
          onClick={() => navigate("/database")}
          type="button"
        >
          Database
        </button>
      </nav>
    </header>
  );
}

function SupportButton({ matchIds, navigate }) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return null;
  }

  return (
    <button
      className="support-link"
      onClick={() => navigate(`/database?matches=${matchIds.map(encodeURIComponent).join(",")}`)}
      type="button"
    >
      支撑对局 {matchIds.length}
    </button>
  );
}

function MatchLink({ children, matchId, navigate }) {
  return (
    <button className="match-link" onClick={() => navigate(`/matches/${encodeURIComponent(matchId)}`)} type="button">
      {children}
    </button>
  );
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function PercentBar({ value }) {
  const width = Number.isFinite(value) ? Math.max(0, Math.min(100, value * 100)) : 0;

  return (
    <span className="percent-bar" aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

function BoardSection({ title, kicker, children, action, note }) {
  return (
    <section className="board-section">
      <div className="board-heading">
        <div>
          <p className="eyebrow">{kicker}</p>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
      {note ? <p className="board-note">{note}</p> : null}
    </section>
  );
}

function LeaderboardList({ entries, emptyText, renderEntry }) {
  if (!entries || entries.length === 0) {
    return <p className="static-empty">{emptyText}</p>;
  }

  return <ol className="leader-list">{entries.map(renderEntry)}</ol>;
}

function StaticHome({ data, navigate }) {
  const boards = data.leaderboards.leaderboards;
  const personalEntries = [
    ...boards.personal_strength.entries,
    ...boards.personal_strength.observation,
  ].sort(
    (a, b) =>
      b.score - a.score ||
      b.games - a.games ||
      a.player_name.localeCompare(b.player_name, "zh-CN"),
  );
  const effortEntries = boards.effort_king.entries.slice(0, 1);
  const layWinEntries = boards.lay_win_king.entries.slice(0, 1);
  const heroLosingEntries = (
    boards.hero_losing.entries.length > 0
      ? boards.hero_losing.entries
      : boards.hero_losing.observation
  ).slice(0, 5);
  const pitEntries = (
    boards.pit_pairs.entries.length > 0 ? boards.pit_pairs.entries : boards.pit_pairs.observation
  ).slice(0, 5);
  const headwindEntries = boards.headwind_engine.entries.slice(0, 5);
  const hasCompleteLineup = boards.best_lineup.assignments.length === lanes.length;
  const summary = data.summary;

  return (
    <main className="friend-page">
      <section className="report-hero">
        <div className="scoreboard-plate">
          <p className="eyebrow">Current period</p>
          <h1>{data.period.name}</h1>
          <div className="hero-scoreline">
            <strong>{summary.win_count}</strong>
            <span>胜</span>
            <strong>{summary.loss_count}</strong>
            <span>负</span>
          </div>
        </div>
        <dl className="report-metrics">
          <div>
            <dt>场次</dt>
            <dd>{summary.match_count}</dd>
          </div>
          <div>
            <dt>原始胜率</dt>
            <dd>{formatPercent(summary.raw_win_rate)}</dd>
          </div>
          <div>
            <dt>可信胜率</dt>
            <dd>{formatPercent(summary.trusted_win_rate)}</dd>
          </div>
          <div>
            <dt>时间</dt>
            <dd>
              {formatDate(summary.date_start)} - {formatDate(summary.date_end)}
            </dd>
          </div>
          <div>
            <dt>五排</dt>
            <dd>{summary.full_stack_match_count}</dd>
          </div>
          <div>
            <dt>4+1</dt>
            <dd>{summary.four_plus_one_match_count}</dd>
          </div>
        </dl>
      </section>

      <BoardSection
        action={
          <button className="text-action" onClick={() => navigate("/database")} type="button">
            打开 Database
          </button>
        }
        kicker="Personal"
        note={boards.personal_strength.plain_language_notes ?? boards.personal_strength.calculation_notes}
        title="最强个人"
      >
        <LeaderboardList
          emptyText="样本不足，暂不生成主榜。"
          entries={personalEntries}
          renderEntry={(entry, index) => (
            <li className="leader-item" key={entry.player_id}>
              <span className="rank-no">{index + 1}</span>
              <div className="leader-main">
                <strong>{entry.player_name}</strong>
                <small>
                  {entry.games} 场 · 均分 {formatMetric(entry.avg_rating)} · KDA{" "}
                  {formatMetric(entry.avg_kda)}
                </small>
                <PercentBar value={entry.trusted_win_rate} />
              </div>
              <div className="leader-score">
                <strong>{formatMetric(entry.score, 0)}</strong>
                <span>{formatPercent(entry.trusted_win_rate)}</span>
              </div>
              <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
            </li>
          )}
        />
      </BoardSection>

      <BoardSection
        kicker="Lineup"
        note={boards.best_lineup.plain_language_notes ?? boards.best_lineup.calculation_notes}
        title="推荐五排阵容"
      >
        {hasCompleteLineup ? (
          <div className="lineup-grid">
            {boards.best_lineup.assignments.map((entry) => (
              <article className="lineup-slot" key={`${entry.lane}-${entry.player_id}`}>
                <span>{entry.lane}</span>
                <strong>{entry.player_name}</strong>
                <small>
                  {entry.games} 场 · 均分 {formatMetric(entry.avg_rating)} · {entry.confidence}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="static-empty">
            样本不足，暂不推荐完整阵容。
            {boards.best_lineup.sample_warnings?.length
              ? ` ${boards.best_lineup.sample_warnings.join("；")}`
              : ""}
          </p>
        )}
        <SupportButton matchIds={boards.best_lineup.supporting_match_ids} navigate={navigate} />
      </BoardSection>

      <div className="board-grid">
        <BoardSection
          kicker="Effort"
          note={boards.effort_king.plain_language_notes ?? boards.effort_king.calculation_notes}
          title="尽力局之王"
        >
          <LeaderboardList
            emptyText="本期没有满足口径的尽力事件。"
            entries={effortEntries}
            renderEntry={(entry, index) => (
              <li className="compact-leader-item" key={entry.player_id}>
                <span className="rank-no">{index + 1}</span>
                <div>
                  <strong>{entry.player_name}</strong>
                  <small>
                    {entry.effort_count} 次 · 败局均分 {formatMetric(entry.avg_loss_rating)}
                  </small>
                </div>
                <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
              </li>
            )}
          />
        </BoardSection>

        <BoardSection
          kicker="For fun"
          note={boards.lay_win_king.plain_language_notes ?? boards.lay_win_king.calculation_notes}
          title="躺赢王"
        >
          <LeaderboardList
            emptyText="本期没有满足口径的躺赢事件。"
            entries={layWinEntries}
            renderEntry={(entry, index) => (
              <li className="compact-leader-item" key={entry.player_id}>
                <span className="rank-no">{index + 1}</span>
                <div>
                  <strong>{entry.player_name}</strong>
                  <small>
                    {entry.lay_win_count} 次 · 胜局均分 {formatMetric(entry.avg_win_rating)}
                  </small>
                </div>
                <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
              </li>
            )}
          />
        </BoardSection>
      </div>

      <BoardSection
        kicker="Hero"
        note={boards.hero_losing.plain_language_notes ?? boards.hero_losing.calculation_notes}
        title="英雄必输榜"
      >
        <LeaderboardList
          emptyText="同人同英雄样本还不够。"
          entries={heroLosingEntries}
          renderEntry={(entry, index) => (
            <li className="leader-item" key={`${entry.player_id}-${entry.hero_name}`}>
              <span className="rank-no">{index + 1}</span>
              <div className="leader-main">
                <strong>
                  {entry.player_name} · {entry.hero_name}
                </strong>
                <small>
                  {entry.games} 场 {entry.wins} 胜 {entry.losses} 负 · 均分{" "}
                  {formatMetric(entry.avg_rating)}
                </small>
                <PercentBar value={entry.trusted_win_rate} />
              </div>
              <div className="leader-score">
                <strong>{formatPercent(entry.trusted_win_rate)}</strong>
                <span>可信胜率</span>
              </div>
              <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
            </li>
          )}
        />
      </BoardSection>

      <div className="board-grid">
        <BoardSection
          kicker="Pair"
          note={boards.pit_pairs.plain_language_notes ?? boards.pit_pairs.calculation_notes}
          title="谁最会坑某人"
        >
          <LeaderboardList
            emptyText="同队/不同队样本还不够。"
            entries={pitEntries}
            renderEntry={(entry, index) => (
              <li className="compact-leader-item" key={`${entry.affected_player_id}-${entry.teammate_id}`}>
                <span className="rank-no">{index + 1}</span>
                <div>
                  <strong>
                    {entry.teammate_name} 坑 {entry.affected_player_name}
                  </strong>
                  <small>影响 {formatPercent(entry.impact, 1)} · 同队 {entry.with_games} 场</small>
                </div>
                <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
              </li>
            )}
          />
        </BoardSection>

        <BoardSection
          kicker="Loss"
          note={boards.headwind_engine.plain_language_notes ?? boards.headwind_engine.calculation_notes}
          title="逆风发动机"
        >
          <LeaderboardList
            emptyText="本期没有明显崩盘代理指标。"
            entries={headwindEntries}
            renderEntry={(entry, index) => (
              <li className="compact-leader-item" key={entry.player_id}>
                <span className="rank-no">{index + 1}</span>
                <div>
                  <strong>{entry.player_name}</strong>
                  <small>
                    崩盘分 {formatMetric(entry.collapse_score_total, 0)} · 败局 {entry.loss_games} 场
                  </small>
                </div>
                <SupportButton matchIds={entry.supporting_match_ids} navigate={navigate} />
              </li>
            )}
          />
        </BoardSection>
      </div>
    </main>
  );
}

function getDatabaseFilters(route) {
  const params = new URLSearchParams(route.search);

  return {
    matchIds: params.get("matches")
      ? params
          .get("matches")
          .split(",")
          .map(decodeURIComponent)
          .filter(Boolean)
      : [],
  };
}

function aggregateDatabaseRows(records) {
  const groups = new Map();

  for (const record of records) {
    const key = [record.player_id, record.hero_name ?? "未确认", record.lane ?? "未确认"].join("\u0000");
    const group = groups.get(key) ?? {
      player_id: record.player_id,
      player_name: record.player_name,
      hero_name: record.hero_name ?? "未确认",
      lane: record.lane ?? "未确认",
      records: [],
    };

    group.records.push(record);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const wins = group.records.filter((record) => record.friend_result === "win").length;
    const matchIds = uniqueValues(group.records.map((record) => record.match_id));

    return {
      ...group,
      games: group.records.length,
      wins,
      losses: group.records.length - wins,
      raw_win_rate: wins / group.records.length,
      trusted_win_rate: trustedWinRate(wins, group.records.length),
      avg_rating: average(group.records.map((record) => record.rating)),
      avg_kda: average(group.records.map((record) => record.kda)),
      avg_damage_dealt_pct: average(group.records.map((record) => record.damage_dealt_pct)),
      avg_damage_taken_pct: average(group.records.map((record) => record.damage_taken_pct)),
      avg_participation_pct: average(group.records.map((record) => record.participation_pct)),
      latest_played_at: group.records
        .map((record) => record.played_at)
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left))[0],
      supporting_match_ids: matchIds,
    };
  });
}

function sortDatabaseRows(rows, sortKey) {
  const sortedRows = [...rows];
  const sorters = {
    time: (left, right) => (right.latest_played_at ?? "").localeCompare(left.latest_played_at ?? ""),
    games: (left, right) => right.games - left.games,
    raw_win_rate: (left, right) => right.raw_win_rate - left.raw_win_rate,
    trusted_win_rate: (left, right) => right.trusted_win_rate - left.trusted_win_rate,
    avg_rating: (left, right) => (right.avg_rating ?? -1) - (left.avg_rating ?? -1),
    avg_kda: (left, right) => (right.avg_kda ?? -1) - (left.avg_kda ?? -1),
    damage: (left, right) =>
      (right.avg_damage_dealt_pct ?? -1) - (left.avg_damage_dealt_pct ?? -1),
    taken: (left, right) =>
      (right.avg_damage_taken_pct ?? -1) - (left.avg_damage_taken_pct ?? -1),
    participation: (left, right) =>
      (right.avg_participation_pct ?? -1) - (left.avg_participation_pct ?? -1),
  };

  return sortedRows.sort((left, right) => {
    const primary = (sorters[sortKey] ?? sorters.time)(left, right);

    return (
      primary ||
      right.games - left.games ||
      left.player_name.localeCompare(right.player_name, "zh-CN")
    );
  });
}

function DatabasePage({ data, navigate, route }) {
  const routeFilters = getDatabaseFilters(route);
  const [filters, setFilters] = useState({
    player: "",
    hero: "",
    lane: "",
    result: "",
    dateFrom: "",
    dateTo: "",
    friendCount: "",
    minGames: 1,
    sort: "time",
  });
  const heroOptions = useMemo(
    () => uniqueValues(data.player_records.map((record) => record.hero_name)).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [data.player_records],
  );
  const filteredRecords = useMemo(() => {
    const matchIdSet = new Set(routeFilters.matchIds);

    return data.player_records.filter((record) => {
      if (matchIdSet.size > 0 && !matchIdSet.has(record.match_id)) {
        return false;
      }

      if (filters.player && record.player_id !== filters.player) {
        return false;
      }

      if (filters.hero && record.hero_name !== filters.hero) {
        return false;
      }

      if (filters.lane && record.lane !== filters.lane) {
        return false;
      }

      if (filters.result && record.friend_result !== filters.result) {
        return false;
      }

      if (filters.friendCount && String(record.friend_count) !== filters.friendCount) {
        return false;
      }

      const date = record.played_at?.slice(0, 10);

      if (filters.dateFrom && date < filters.dateFrom) {
        return false;
      }

      if (filters.dateTo && date > filters.dateTo) {
        return false;
      }

      return true;
    });
  }, [data.player_records, filters, routeFilters.matchIds]);
  const rows = useMemo(
    () =>
      sortDatabaseRows(
        aggregateDatabaseRows(filteredRecords).filter((row) => row.games >= Number(filters.minGames || 1)),
        filters.sort,
      ),
    [filteredRecords, filters.minGames, filters.sort],
  );

  function updateFilter(field, value) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
  }

  return (
    <main className="friend-page">
      <section className="database-header">
        <div>
          <p className="eyebrow">Database</p>
          <h1>脱敏对局库</h1>
        </div>
        {routeFilters.matchIds.length > 0 ? (
          <button className="support-link" onClick={() => navigate("/database")} type="button">
            清除支撑对局筛选
          </button>
        ) : null}
      </section>

      <section className="database-filters" aria-label="Database 筛选">
        <label>
          <span>玩家</span>
          <select value={filters.player} onChange={(event) => updateFilter("player", event.target.value)}>
            <option value="">全部</option>
            {data.friends.map((friend) => (
              <option key={friend.id} value={friend.id}>
                {friend.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>英雄</span>
          <select value={filters.hero} onChange={(event) => updateFilter("hero", event.target.value)}>
            <option value="">全部</option>
            {heroOptions.map((hero) => (
              <option key={hero} value={hero}>
                {hero}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>位置</span>
          <select value={filters.lane} onChange={(event) => updateFilter("lane", event.target.value)}>
            <option value="">全部</option>
            {lanes.map((lane) => (
              <option key={lane} value={lane}>
                {lane}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>胜负</span>
          <select value={filters.result} onChange={(event) => updateFilter("result", event.target.value)}>
            <option value="">全部</option>
            <option value="win">胜</option>
            <option value="loss">负</option>
          </select>
        </label>
        <label>
          <span>日期起</span>
          <input value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} type="date" />
        </label>
        <label>
          <span>日期止</span>
          <input value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} type="date" />
        </label>
        <label>
          <span>组合人数</span>
          <select value={filters.friendCount} onChange={(event) => updateFilter("friendCount", event.target.value)}>
            <option value="">全部</option>
            <option value="5">5 人</option>
            <option value="4">4+1</option>
          </select>
        </label>
        <label>
          <span>最低场次</span>
          <input
            min="1"
            type="number"
            value={filters.minGames}
            onChange={(event) => updateFilter("minGames", event.target.value)}
          />
        </label>
        <label>
          <span>排序</span>
          <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
            <option value="time">时间</option>
            <option value="games">场次</option>
            <option value="raw_win_rate">胜率</option>
            <option value="trusted_win_rate">可信胜率</option>
            <option value="avg_rating">平均评分</option>
            <option value="avg_kda">KDA</option>
            <option value="damage">输出占比</option>
            <option value="taken">承伤占比</option>
            <option value="participation">参团率</option>
          </select>
        </label>
      </section>

      <section className="database-table-wrap">
        <table className="database-table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>英雄</th>
              <th>位置</th>
              <th>场次</th>
              <th>胜率</th>
              <th>可信胜率</th>
              <th>均分</th>
              <th>KDA</th>
              <th>输出</th>
              <th>承伤</th>
              <th>参团</th>
              <th>最近</th>
              <th>支撑</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.player_id}-${row.hero_name}-${row.lane}`}>
                <td>{row.player_name}</td>
                <td>{row.hero_name}</td>
                <td>{row.lane}</td>
                <td>{row.games}</td>
                <td>
                  {row.wins}-{row.losses} · {formatPercent(row.raw_win_rate)}
                </td>
                <td>{formatPercent(row.trusted_win_rate)}</td>
                <td>{formatMetric(row.avg_rating)}</td>
                <td>{formatMetric(row.avg_kda)}</td>
                <td>{formatMetric(row.avg_damage_dealt_pct, 0)}%</td>
                <td>{formatMetric(row.avg_damage_taken_pct, 0)}%</td>
                <td>{formatMetric(row.avg_participation_pct, 0)}%</td>
                <td>{formatFullDateTime(row.latest_played_at)}</td>
                <td>
                  <SupportButton matchIds={row.supporting_match_ids} navigate={navigate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function PlayerDetailTable({ title, players }) {
  return (
    <section className="match-detail-section">
      <div className="board-heading">
        <h2>{title}</h2>
        <span>{players.length} 人</span>
      </div>
      <div className="database-table-wrap">
        <table className="database-table match-player-table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>英雄</th>
              <th>位置</th>
              <th>评分</th>
              <th>KDA</th>
              <th>输出</th>
              <th>承伤</th>
              <th>参团</th>
              <th>标记</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={`${player.side}-${player.slot}-${player.player_id ?? player.label}`}>
                <td>{player.player_name ?? player.label}</td>
                <td>{player.hero_name ?? "—"}</td>
                <td>{player.lane ?? "—"}</td>
                <td>{formatMetric(player.rating)}</td>
                <td>
                  {player.kills ?? "—"}/{player.deaths ?? "—"}/{player.assists ?? "—"}
                </td>
                <td>{formatMetric(player.damage_dealt_pct, 0)}%</td>
                <td>{formatMetric(player.damage_taken_pct, 0)}%</td>
                <td>{formatMetric(player.participation_pct, 0)}%</td>
                <td>
                  {[player.is_mvp ? "MVP" : null, player.is_svp ? "SVP" : null, ...(player.medals ?? [])]
                    .filter(Boolean)
                    .join("、") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MatchDetailPage({ data, navigate, route }) {
  const matchId = decodeURIComponent(route.pathname.replace(/^\/matches\//, ""));
  const match = data.matches.find((item) => item.id === matchId);

  if (!match) {
    return (
      <main className="friend-page">
        <section className="detail-empty">没有找到这局脱敏数据。</section>
      </main>
    );
  }

  return (
    <main className="friend-page">
      <section className="match-detail-hero">
        <button className="support-link" onClick={() => navigate("/database")} type="button">
          返回 Database
        </button>
        <div>
          <p className="eyebrow">Match detail</p>
          <h1>
            {match.local_match_no} · {formatFullDateTime(match.played_at)}
          </h1>
        </div>
        <dl className="report-metrics compact-metrics">
          <div>
            <dt>结果</dt>
            <dd>{resultLabel[match.friend_result] ?? match.friend_result}</dd>
          </div>
          <div>
            <dt>比分</dt>
            <dd>{match.score.display}</dd>
          </div>
          <div>
            <dt>朋友队</dt>
            <dd>{match.friend_side}</dd>
          </div>
          <div>
            <dt>人数</dt>
            <dd>{match.friend_count}/5</dd>
          </div>
          <div>
            <dt>模式</dt>
            <dd>{match.mode}</dd>
          </div>
          <div>
            <dt>时长</dt>
            <dd>{formatDuration(match.duration_seconds)}</dd>
          </div>
        </dl>
      </section>

      <PlayerDetailTable title="朋友队" players={match.friend_players} />
      <PlayerDetailTable title="匿名对手与路人" players={match.background_players} />
    </main>
  );
}

function FriendSite({ data, navigate, route }) {
  let page;

  if (route.pathname.startsWith("/matches/")) {
    page = <MatchDetailPage data={data} navigate={navigate} route={route} />;
  } else if (route.pathname === "/database") {
    page = <DatabasePage data={data} navigate={navigate} route={route} />;
  } else {
    page = <StaticHome data={data} navigate={navigate} />;
  }

  return (
    <div className="friend-site">
      <StaticNav navigate={navigate} route={route} />
      {page}
    </div>
  );
}

function App() {
  const [route, navigate] = useRoute();
  const staticExport = useStaticExport();
  const {
    approveMatch,
    apiState,
    error,
    friends,
    heroes,
    importedMatches,
    isLoadingImportedDetail,
    isLoadingReviewDetail,
    rejectMatch,
    reviewMatches,
    saveImportedMatch,
    saveDraft,
    selectedImportedId,
    selectedImportedMatch,
    selectedReviewId,
    selectedReviewMatch,
    setSelectedImportedId,
    setSelectedReviewId,
    updateExistingMatch,
  } = useApi();
  const isRootRoute = route.pathname === "/";
  const isStaticRoute = route.pathname === "/database" || route.pathname.startsWith("/matches/");
  const shouldPreferStaticHome = isRootRoute && !isLocalHostname(window.location.hostname);
  const shouldRenderStaticSite =
    staticExport.status === "ready" && (isStaticRoute || shouldPreferStaticHome || apiState === "offline");
  const [activeView, setActiveView] = useState("review");
  const reviewQueue = useMemo(
    () => reviewMatches.filter((reviewMatch) => isReviewableStatus(reviewMatch.status)),
    [reviewMatches],
  );
  const pendingCount = useMemo(
    () => reviewMatches.filter((reviewMatch) => reviewMatch.status === "pending_review").length,
    [reviewMatches],
  );
  const activeItems = activeView === "review" ? reviewQueue : importedMatches;
  const selectedId = activeView === "review" ? selectedReviewId : selectedImportedId;
  const selectedMatch = activeView === "review" ? selectedReviewMatch : selectedImportedMatch;
  const setSelectedId = activeView === "review" ? setSelectedReviewId : setSelectedImportedId;
  const isLoadingDetail =
    activeView === "review" ? isLoadingReviewDetail : isLoadingImportedDetail;

  useEffect(() => {
    if (activeView !== "review") {
      return;
    }

    if (reviewQueue.length === 0) {
      setSelectedReviewId(null);
      return;
    }

    if (!reviewQueue.some((reviewMatch) => reviewMatch.id === selectedReviewId)) {
      setSelectedReviewId(reviewQueue[0].id);
    }
  }, [activeView, reviewQueue, selectedReviewId, setSelectedReviewId]);

  if (shouldRenderStaticSite) {
    return <FriendSite data={staticExport.data} navigate={navigate} route={route} />;
  }

  if (isStaticRoute || shouldPreferStaticHome) {
    if (staticExport.status === "loading") {
      // 与 index.html 中的 .initial-loader 共用样式，避免首屏 spinner → 文字 → 内容的两段跳变
      return (
        <div className="initial-loader" role="status" aria-live="polite">
          <div className="initial-loader__spinner" aria-hidden="true"></div>
          <div className="initial-loader__hint">读取战报中…</div>
        </div>
      );
    }
    return <main className="detail-empty">{staticExport.error}</main>;
  }

  return (
    <main className="shell">
      <aside className="review-rail">
        <section className="workspace-header">
          <div>
            <p className="eyebrow">Local-first Admin</p>
            <h1>王者五排战报工作台</h1>
          </div>
          <span className={`status status-${apiState}`}>{statusLabel[apiState]}</span>
        </section>

        <section className="queue-summary" aria-label="审核队列概览">
          <div>
            <span>待审核</span>
            <strong>{pendingCount}</strong>
          </div>
          <div>
            <span>已入库</span>
            <strong>{importedMatches.length}</strong>
          </div>
        </section>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="rail-tabs" role="tablist" aria-label="工作区">
          <button
            aria-selected={activeView === "review"}
            className={activeView === "review" ? "rail-tab rail-tab-active" : "rail-tab"}
            onClick={() => setActiveView("review")}
            role="tab"
            type="button"
          >
            待审队列
          </button>
          <button
            aria-selected={activeView === "matches"}
            className={activeView === "matches" ? "rail-tab rail-tab-active" : "rail-tab"}
            onClick={() => setActiveView("matches")}
            role="tab"
            type="button"
          >
            已入库
          </button>
        </div>

        <QueueList
          emptyText={
            activeView === "review"
              ? "先运行 review JSON 导入脚本，再回到这里审核。"
              : "批准待审局后，正式对局会出现在这里。"
          }
          emptyTitle={activeView === "review" ? "没有待审局" : "没有已入库局"}
          items={activeItems}
          onSelect={setSelectedId}
          selectedId={selectedId}
        />
      </aside>

      <DetailPane
        friends={friends}
        heroes={heroes}
        isLoadingDetail={isLoadingDetail}
        onApproveMatch={approveMatch}
        onRejectMatch={rejectMatch}
        onSaveImportedMatch={saveImportedMatch}
        onSaveDraft={saveDraft}
        onUpdateExistingMatch={updateExistingMatch}
        recordType={activeView === "review" ? "review" : "match"}
        selectedMatch={selectedMatch}
      />
    </main>
  );
}

const rootElement = document.getElementById("root");

function fatalErrorPage(prefix, err) {
  const message = err?.stack || err?.message || String(err);
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "padding:24px;min-height:100vh;background:#1a1f2e;color:#ffd9d9;font:13px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;box-sizing:border-box;";
  wrap.textContent = `[${prefix}]\n${message}`;
  return wrap;
}

function appendErrorBanner(prefix, err) {
  try {
    const message = err?.message || (typeof err === "string" ? err : "未知错误");
    const banner = document.createElement("div");
    banner.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:10px 14px;border-radius:10px;background:rgba(26,31,46,0.92);color:#ffd9d9;font:12px/1.4 ui-monospace,Consolas,monospace;box-shadow:0 6px 20px rgba(0,0,0,0.25);max-height:40vh;overflow:auto;";
    banner.textContent = `[${prefix}] ${message}`;
    document.body.appendChild(banner);
  } catch {}
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    appendErrorBanner("window.error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    appendErrorBanner("unhandledrejection", event.reason);
  });
}

class FatalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error;
      const message = err?.stack || err?.message || String(err);
      return (
        <pre
          style={{
            padding: "24px",
            margin: 0,
            minHeight: "100vh",
            background: "#1a1f2e",
            color: "#ffd9d9",
            font: "13px/1.5 ui-monospace,Consolas,monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            boxSizing: "border-box",
          }}
        >
          {`[React render]\n${message}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(rootElement);

try {
  root.render(
    <FatalErrorBoundary>
      <App />
    </FatalErrorBoundary>,
  );
} catch (err) {
  rootElement.replaceChildren(fatalErrorPage("render-throw", err));
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}

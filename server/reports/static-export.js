import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLatestReportPeriod, getReportPeriod } from "./report-periods.js";
import { calculateLeaderboards } from "../stats/leaderboards.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const blockedStaticKeys = new Set([
  "raw_name",
  "raw_hero",
  "raw_review_json",
  "normalized_json",
  "field_sources_json",
  "overview_path",
  "detail_path",
  "dedupe_key",
  "dedupe_override_reason",
]);

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizePercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.abs(value) <= 1 ? value * 100 : value));
}

function kda(player) {
  if (
    !Number.isFinite(player.kills) ||
    !Number.isFinite(player.deaths) ||
    !Number.isFinite(player.assists)
  ) {
    return null;
  }

  return round((player.kills + player.assists) / Math.max(1, player.deaths));
}

function rawWinRate(wins, games) {
  return games > 0 ? wins / games : null;
}

function trustedWinRate(wins, games) {
  return games > 0 ? (wins + 3) / (games + 6) : null;
}

function loadMatches(db, matchIds) {
  if (matchIds.length === 0) {
    return [];
  }

  const rows = db
    .prepare(
      `
        SELECT
          matches.id,
          matches.batch_id,
          review_matches.local_match_no,
          matches.mode,
          matches.played_at,
          matches.duration_seconds,
          matches.blue_score,
          matches.red_score,
          matches.winner_side,
          matches.friend_side,
          matches.friend_result,
          matches.friend_count,
          matches.include_in_personal_stats,
          matches.include_in_pair_stats,
          matches.include_in_lineup_stats,
          matches.include_in_for_fun_stats,
          matches.exclude_reason
        FROM matches
        LEFT JOIN review_matches
          ON review_matches.id = matches.review_match_id
        WHERE matches.id IN (${placeholders(matchIds)})
      `,
    )
    .all(...matchIds);
  const order = new Map(matchIds.map((matchId, index) => [matchId, index]));

  return rows.sort((left, right) => order.get(left.id) - order.get(right.id));
}

function loadPlayers(db, matchIds) {
  if (matchIds.length === 0) {
    return [];
  }

  return db
    .prepare(
      `
        SELECT
          match_players.match_id,
          match_players.player_id,
          players.display_name AS player_name,
          match_players.side,
          match_players.slot,
          match_players.is_friend,
          match_players.hero_id,
          match_players.hero_name,
          match_players.lane,
          match_players.rating,
          match_players.kills,
          match_players.deaths,
          match_players.assists,
          match_players.economy,
          match_players.damage_dealt_pct,
          match_players.damage_taken_pct,
          match_players.team_economy_pct,
          match_players.participation_pct,
          match_players.medals_json,
          match_players.is_mvp,
          match_players.is_svp
        FROM match_players
        LEFT JOIN players
          ON players.id = match_players.player_id
        WHERE match_players.match_id IN (${placeholders(matchIds)})
        ORDER BY
          CASE match_players.side WHEN 'blue' THEN 0 ELSE 1 END,
          match_players.slot ASC
      `,
    )
    .all(...matchIds);
}

function loadFriends(db) {
  return db
    .prepare(
      `
        SELECT id, display_name, game_nickname
        FROM players
        WHERE is_friend = 1
        ORDER BY display_name COLLATE NOCASE ASC
      `,
    )
    .all();
}

function toSafeFriendPlayer(player) {
  return {
    player_id: player.player_id,
    player_name: player.player_name,
    side: player.side,
    slot: player.slot,
    hero_id: player.hero_id,
    hero_name: player.hero_name,
    lane: player.lane,
    rating: player.rating,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    kda: kda(player),
    economy: player.economy,
    damage_dealt_pct: normalizePercent(player.damage_dealt_pct),
    damage_taken_pct: normalizePercent(player.damage_taken_pct),
    team_economy_pct: normalizePercent(player.team_economy_pct),
    participation_pct: normalizePercent(player.participation_pct),
    medals: parseJsonField(player.medals_json, []),
    is_mvp: player.is_mvp === 1,
    is_svp: player.is_svp === 1,
  };
}

function toBackgroundPlayer(player, match) {
  const opponentIndex = player.slot;

  return {
    label: player.side === match.friend_side ? "路人队友" : `对手${opponentIndex}`,
    side: player.side,
    slot: player.slot,
    hero_id: player.hero_id,
    hero_name: player.hero_name,
    lane: player.lane,
    rating: player.rating,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    kda: kda(player),
    damage_dealt_pct: normalizePercent(player.damage_dealt_pct),
    damage_taken_pct: normalizePercent(player.damage_taken_pct),
    participation_pct: normalizePercent(player.participation_pct),
    medals: parseJsonField(player.medals_json, []),
    is_mvp: player.is_mvp === 1,
    is_svp: player.is_svp === 1,
  };
}

function toMatchExport(match, players) {
  const friendPlayers = players.filter((player) => player.is_friend === 1).map(toSafeFriendPlayer);
  const backgroundPlayers = players
    .filter((player) => player.is_friend !== 1)
    .map((player) => toBackgroundPlayer(player, match));

  return {
    id: match.id,
    batch_id: match.batch_id,
    local_match_no: match.local_match_no,
    mode: match.mode,
    played_at: match.played_at,
    duration_seconds: match.duration_seconds,
    score: {
      blue: match.blue_score,
      red: match.red_score,
      display: `${match.blue_score}:${match.red_score}`,
    },
    winner_side: match.winner_side,
    friend_side: match.friend_side,
    friend_result: match.friend_result,
    friend_count: match.friend_count,
    include_in_personal_stats: match.include_in_personal_stats === 1,
    include_in_pair_stats: match.include_in_pair_stats === 1,
    include_in_lineup_stats: match.include_in_lineup_stats === 1,
    include_in_for_fun_stats: match.include_in_for_fun_stats === 1,
    exclude_reason: match.exclude_reason,
    friend_players: friendPlayers,
    background_players: backgroundPlayers,
  };
}

function flattenPlayerRecords(matches) {
  return matches.flatMap((match) =>
    match.friend_players.map((player) => ({
      match_id: match.id,
      local_match_no: match.local_match_no,
      played_at: match.played_at,
      mode: match.mode,
      friend_result: match.friend_result,
      friend_count: match.friend_count,
      include_in_personal_stats: match.include_in_personal_stats,
      include_in_pair_stats: match.include_in_pair_stats,
      include_in_lineup_stats: match.include_in_lineup_stats,
      include_in_for_fun_stats: match.include_in_for_fun_stats,
      player_id: player.player_id,
      player_name: player.player_name,
      hero_id: player.hero_id,
      hero_name: player.hero_name,
      lane: player.lane,
      rating: player.rating,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      kda: player.kda,
      damage_dealt_pct: player.damage_dealt_pct,
      damage_taken_pct: player.damage_taken_pct,
      team_economy_pct: player.team_economy_pct,
      participation_pct: player.participation_pct,
      is_mvp: player.is_mvp,
      is_svp: player.is_svp,
    })),
  );
}

function summarize(matches, playerRecords) {
  const winCount = matches.filter((match) => match.friend_result === "win").length;
  const timestamps = matches
    .map((match) => match.played_at)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const friends = new Set(playerRecords.map((record) => record.player_id));

  return {
    match_count: matches.length,
    friend_player_count: playerRecords.length,
    friend_count: friends.size,
    win_count: winCount,
    loss_count: matches.length - winCount,
    raw_win_rate: round(rawWinRate(winCount, matches.length), 4),
    trusted_win_rate: round(trustedWinRate(winCount, matches.length), 4),
    date_start: timestamps[0] ?? null,
    date_end: timestamps.at(-1) ?? null,
    full_stack_match_count: matches.filter((match) => match.friend_count >= 5).length,
    four_plus_one_match_count: matches.filter((match) => match.friend_count === 4).length,
  };
}

function collectBlockedKeys(value, path = "$", blockedKeys = []) {
  if (!value || typeof value !== "object") {
    return blockedKeys;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectBlockedKeys(item, `${path}[${index}]`, blockedKeys));
    return blockedKeys;
  }

  for (const [key, child] of Object.entries(value)) {
    if (blockedStaticKeys.has(key)) {
      blockedKeys.push(`${path}.${key}`);
    }

    collectBlockedKeys(child, `${path}.${key}`, blockedKeys);
  }

  return blockedKeys;
}

export function assertStaticExportPrivacy(payload) {
  const blockedKeys = collectBlockedKeys(payload);

  if (blockedKeys.length > 0) {
    throw new Error(`Static export contains blocked fields: ${blockedKeys.join(", ")}`);
  }
}

export function buildStaticExport(db, options = {}) {
  const period = options.periodId ? getReportPeriod(db, options.periodId) : getLatestReportPeriod(db);

  if (!period) {
    throw new Error("No report period found. Create a report period before exporting static data.");
  }

  const matchRows = loadMatches(db, period.match_ids);
  const playersByMatch = new Map();

  for (const player of loadPlayers(db, matchRows.map((match) => match.id))) {
    if (!playersByMatch.has(player.match_id)) {
      playersByMatch.set(player.match_id, []);
    }

    playersByMatch.get(player.match_id).push(player);
  }

  const matches = matchRows.map((match) => toMatchExport(match, playersByMatch.get(match.id) ?? []));
  const playerRecords = flattenPlayerRecords(matches);
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    privacy: {
      opponent_label_policy: "对手和路人只导出匿名标签，不导出昵称、截图、OCR 原文或管理员修正详情。",
      excluded_fields: Array.from(blockedStaticKeys).sort(),
    },
    period,
    summary: summarize(matches, playerRecords),
    friends: loadFriends(db),
    matches,
    player_records: playerRecords,
    leaderboards: calculateLeaderboards(db, {
      periodId: period.id,
    }),
  };

  assertStaticExportPrivacy(payload);

  return payload;
}

export function getDefaultStaticExportPath() {
  return join(projectRoot, "public", "export", "report-data.json");
}

export async function writeStaticExport(payload, outputPath = getDefaultStaticExportPath()) {
  assertStaticExportPrivacy(payload);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return outputPath;
}

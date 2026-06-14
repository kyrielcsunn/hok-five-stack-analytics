import { createHash } from "node:crypto";

const fiveMinutesMs = 5 * 60 * 1000;

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeDateTime(value) {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? normalizeText(value) : new Date(timestamp).toISOString();
}

function normalizeInteger(value) {
  return Number.isInteger(value) ? value : null;
}

function sortedUnique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function overlapRatio(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(left.size, right.size);
}

function heroKey(player) {
  return normalizeText(player.hero_id ?? player.hero_name ?? player.raw_hero);
}

export function buildDedupeFeatures(normalizedJson, friendIdsByName) {
  const match = normalizedJson.match ?? {};
  const players = normalizedJson.players ?? [];
  const friendSide = match.friend_side;
  const friendPlayers = players.filter(
    (player) => player.is_friend_candidate && (!friendSide || player.side === friendSide),
  );
  const enemyPlayers = players.filter((player) => friendSide && player.side !== friendSide);
  const friendIds = friendPlayers.map((player) => {
    const friendKey = friendIdsByName?.get(player.friend_candidate) ?? friendIdsByName?.get(player.raw_name);

    return normalizeText(friendKey ?? player.friend_candidate ?? player.raw_name);
  });

  return {
    mode: normalizeText(match.mode),
    playedAt: normalizeDateTime(match.played_at),
    playedAtMs: Date.parse(match.played_at),
    durationSeconds: normalizeInteger(match.duration_seconds),
    blueScore: normalizeInteger(match.blue_score),
    redScore: normalizeInteger(match.red_score),
    friendResult: normalizeText(match.friend_result),
    friendIds: sortedUnique(friendIds),
    friendHeroes: sortedUnique(friendPlayers.map(heroKey)),
    enemyHeroes: sortedUnique(enemyPlayers.map(heroKey)),
  };
}

export function buildMatchDedupeFeatures(matchRow, playerRows) {
  const friendPlayers = playerRows.filter((player) => player.is_friend === 1);
  const enemyPlayers = playerRows.filter((player) => player.is_friend !== 1);

  return {
    mode: normalizeText(matchRow.mode),
    playedAt: normalizeDateTime(matchRow.played_at),
    playedAtMs: Date.parse(matchRow.played_at),
    durationSeconds: normalizeInteger(matchRow.duration_seconds),
    blueScore: normalizeInteger(matchRow.blue_score),
    redScore: normalizeInteger(matchRow.red_score),
    friendResult: normalizeText(matchRow.friend_result),
    friendIds: sortedUnique(friendPlayers.map((player) => normalizeText(player.player_id ?? player.raw_name))),
    friendHeroes: sortedUnique(friendPlayers.map(heroKey)),
    enemyHeroes: sortedUnique(enemyPlayers.map(heroKey)),
  };
}

export function createDedupeKeyFromFeatures(features) {
  const exactPayload = {
    mode: features.mode,
    playedAt: features.playedAt,
    durationSeconds: features.durationSeconds,
    blueScore: features.blueScore,
    redScore: features.redScore,
    friendResult: features.friendResult,
    friendIds: features.friendIds,
    friendHeroes: features.friendHeroes,
    enemyHeroes: features.enemyHeroes,
  };
  const digest = createHash("sha256").update(JSON.stringify(exactPayload)).digest("hex").slice(0, 24);

  return `dedupe:v1:${digest}`;
}

export function createDedupeKey(normalizedJson, friendIdsByName) {
  return createDedupeKeyFromFeatures(buildDedupeFeatures(normalizedJson, friendIdsByName));
}

function getExistingMatches(db) {
  const matches = db
    .prepare(
      `
        SELECT
          id,
          batch_id,
          review_match_id,
          mode,
          played_at,
          duration_seconds,
          blue_score,
          red_score,
          friend_result,
          friend_count,
          dedupe_key,
          dedupe_override_reason
        FROM matches
        ORDER BY played_at DESC, id ASC
      `,
    )
    .all();
  const playersByMatchId = new Map();
  const players = db
    .prepare(
      `
        SELECT
          match_id,
          player_id,
          raw_name,
          raw_hero,
          hero_id,
          hero_name,
          is_friend
        FROM match_players
      `,
    )
    .all();

  for (const player of players) {
    const matchPlayers = playersByMatchId.get(player.match_id) ?? [];

    matchPlayers.push(player);
    playersByMatchId.set(player.match_id, matchPlayers);
  }

  return matches.map((match) => ({
    ...match,
    players: playersByMatchId.get(match.id) ?? [],
  }));
}

function buildConflict(target, existing) {
  const existingFeatures = buildMatchDedupeFeatures(existing, existing.players);
  const existingDedupeKey = createDedupeKeyFromFeatures(existingFeatures);
  const isExact =
    existing.dedupe_key === target.dedupeKey || existingDedupeKey === target.dedupeKey;
  const timeDeltaMs = Math.abs(target.features.playedAtMs - existingFeatures.playedAtMs);
  const timeClose =
    Number.isFinite(timeDeltaMs) && timeDeltaMs <= fiveMinutesMs;
  const friendOverlap = overlapRatio(target.features.friendIds, existingFeatures.friendIds);
  const friendHeroOverlap = overlapRatio(target.features.friendHeroes, existingFeatures.friendHeroes);
  const enemyHeroOverlap = overlapRatio(target.features.enemyHeroes, existingFeatures.enemyHeroes);
  const scoreClose =
    target.features.blueScore !== null &&
    target.features.redScore !== null &&
    existingFeatures.blueScore !== null &&
    existingFeatures.redScore !== null &&
    Math.abs(target.features.blueScore - existingFeatures.blueScore) <= 2 &&
    Math.abs(target.features.redScore - existingFeatures.redScore) <= 2;
  const durationClose =
    target.features.durationSeconds !== null &&
    existingFeatures.durationSeconds !== null &&
    Math.abs(target.features.durationSeconds - existingFeatures.durationSeconds) <= 60;
  const modeMatches = target.features.mode === existingFeatures.mode;
  const reasons = [];

  if (isExact) {
    reasons.push("去重指纹完全一致");
  }

  if (timeClose) {
    reasons.push("对局时间相差小于 5 分钟");
  }

  if (friendOverlap >= 0.8) {
    reasons.push("朋友成员高度重合");
  }

  if (friendHeroOverlap >= 0.8) {
    reasons.push("朋友英雄高度重合");
  }

  if (scoreClose) {
    reasons.push("比分接近");
  }

  if (durationClose) {
    reasons.push("时长接近");
  }

  if (enemyHeroOverlap >= 0.6) {
    reasons.push("敌方英雄高度重合");
  }

  const isSimilar =
    timeClose &&
    friendOverlap >= 0.8 &&
    modeMatches &&
    (friendHeroOverlap >= 0.8 || (scoreClose && durationClose) || enemyHeroOverlap >= 0.6);

  if (!isExact && !isSimilar) {
    return null;
  }

  return {
    type: isExact ? "exact" : "similar",
    match_id: existing.id,
    review_match_id: existing.review_match_id,
    played_at: existing.played_at,
    mode: existing.mode,
    score: `${existing.blue_score}:${existing.red_score}`,
    friend_result: existing.friend_result,
    friend_count: existing.friend_count,
    dedupe_key: existing.dedupe_key,
    similarity: {
      friend_overlap: Number(friendOverlap.toFixed(2)),
      friend_hero_overlap: Number(friendHeroOverlap.toFixed(2)),
      enemy_hero_overlap: Number(enemyHeroOverlap.toFixed(2)),
      time_delta_seconds: Number.isFinite(timeDeltaMs) ? Math.round(timeDeltaMs / 1000) : null,
      score_close: scoreClose,
      duration_close: durationClose,
    },
    reasons,
  };
}

export function findDedupeConflicts(db, normalizedJson, friendIdsByName) {
  const features = buildDedupeFeatures(normalizedJson, friendIdsByName);
  const dedupeKey = createDedupeKeyFromFeatures(features);
  const target = {
    dedupeKey,
    features,
  };

  return {
    dedupe_key: dedupeKey,
    conflicts: getExistingMatches(db)
      .map((existing) => buildConflict(target, existing))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "exact" ? -1 : 1;
        }

        return left.match_id.localeCompare(right.match_id);
      }),
  };
}

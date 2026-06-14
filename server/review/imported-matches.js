import { createDedupeKey } from "./dedupe.js";
import {
  insertReviewEvent,
  loadFriendIdsByName,
  loadFriendRecordsByName,
  normalizeKnownFriendCandidates,
  resolveFriendId,
  toDbBool,
  toJson,
  updateBatchStatus,
  validateApprovableReview,
} from "./review-actions.js";
import { getReviewMatch } from "./review-matches.js";

const matchFields = [
  "mode",
  "played_at",
  "duration_seconds",
  "blue_score",
  "red_score",
  "winner_side",
  "friend_side",
  "friend_result",
  "include_in_personal_stats",
  "include_in_pair_stats",
  "include_in_lineup_stats",
  "include_in_for_fun_stats",
  "exclude_reason",
];

const playerFields = [
  "raw_name",
  "friend_candidate",
  "is_friend_candidate",
  "raw_hero",
  "hero_id",
  "hero_name",
  "rating",
  "kills",
  "deaths",
  "assists",
  "economy",
  "damage_dealt",
  "damage_dealt_pct",
  "damage_taken",
  "damage_taken_pct",
  "team_economy_pct",
  "participation_pct",
  "medals",
  "lane",
  "lane_source",
  "lane_confidence",
  "is_mvp",
  "is_svp",
];

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function fromDbBool(value) {
  return value === 1;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function localMatchNo(row) {
  if (row.local_match_no) {
    return row.local_match_no;
  }

  if (row.review_match_id?.includes(":")) {
    return row.review_match_id.split(":").at(-1);
  }

  return row.id;
}

function listScreenshotPaths(db, matchId) {
  const rows = db
    .prepare(
      `
        SELECT screenshot_type, local_path
        FROM screenshots
        WHERE match_id = ?
      `,
    )
    .all(matchId);

  return Object.fromEntries(rows.map((row) => [row.screenshot_type, row.local_path]));
}

function getMatchRow(db, id) {
  return db
    .prepare(
      `
        SELECT
          matches.id,
          matches.batch_id,
          matches.review_match_id,
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
          matches.exclude_reason,
          matches.dedupe_key,
          matches.dedupe_override_reason,
          matches.created_at,
          matches.updated_at,
          review_matches.local_match_no
        FROM matches
        LEFT JOIN review_matches
          ON review_matches.id = matches.review_match_id
        WHERE matches.id = ?
      `,
    )
    .get(id);
}

function listPlayerRows(db, matchId) {
  return db
    .prepare(
      `
        SELECT
          match_players.id,
          match_players.match_id,
          match_players.player_id,
          match_players.raw_name,
          match_players.side,
          match_players.slot,
          match_players.is_friend,
          match_players.raw_hero,
          match_players.hero_id,
          match_players.hero_name,
          match_players.lane,
          match_players.lane_source,
          match_players.lane_confidence,
          match_players.rating,
          match_players.kills,
          match_players.deaths,
          match_players.assists,
          match_players.economy,
          match_players.damage_dealt,
          match_players.damage_dealt_pct,
          match_players.damage_taken,
          match_players.damage_taken_pct,
          match_players.team_economy_pct,
          match_players.participation_pct,
          match_players.medals_json,
          match_players.is_mvp,
          match_players.is_svp,
          match_players.field_sources_json,
          players.display_name AS friend_candidate
        FROM match_players
        LEFT JOIN players
          ON players.id = match_players.player_id
        WHERE match_players.match_id = ?
        ORDER BY
          CASE match_players.side WHEN 'blue' THEN 0 ELSE 1 END,
          match_players.slot ASC
      `,
    )
    .all(matchId);
}

function toPlayerDraft(row) {
  return {
    side: row.side,
    slot: row.slot,
    raw_name: row.raw_name,
    friend_candidate: row.friend_candidate,
    is_friend_candidate: fromDbBool(row.is_friend),
    raw_hero: row.raw_hero,
    hero_id: row.hero_id,
    hero_name: row.hero_name,
    rating: row.rating,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    economy: row.economy,
    damage_dealt: row.damage_dealt,
    damage_dealt_pct: row.damage_dealt_pct,
    damage_taken: row.damage_taken,
    damage_taken_pct: row.damage_taken_pct,
    team_economy_pct: row.team_economy_pct,
    participation_pct: row.participation_pct,
    medals: parseJsonField(row.medals_json, []),
    lane: row.lane,
    lane_source: row.lane_source,
    lane_confidence: row.lane_confidence,
    is_mvp: fromDbBool(row.is_mvp),
    is_svp: fromDbBool(row.is_svp),
  };
}

function toNormalizedJson(db, matchRow, playerRows) {
  const screenshots = listScreenshotPaths(db, matchRow.id);
  const fallbackNo = localMatchNo(matchRow);
  const fieldConfidencePlayers = {};

  for (const row of playerRows) {
    fieldConfidencePlayers[row.side] ??= {};
    fieldConfidencePlayers[row.side][row.slot] = parseJsonField(row.field_sources_json, {});
  }

  return {
    source: {
      batch_id: matchRow.batch_id,
      local_match_no: fallbackNo,
      overview_path: screenshots.overview ?? `unlinked:${matchRow.id}:overview`,
      detail_path: screenshots.detail ?? `unlinked:${matchRow.id}:detail`,
    },
    match: {
      mode: matchRow.mode,
      played_at: matchRow.played_at,
      duration_seconds: matchRow.duration_seconds,
      blue_score: matchRow.blue_score,
      red_score: matchRow.red_score,
      winner_side: matchRow.winner_side,
      friend_side: matchRow.friend_side,
      friend_result: matchRow.friend_result,
      include_in_personal_stats: fromDbBool(matchRow.include_in_personal_stats),
      include_in_pair_stats: fromDbBool(matchRow.include_in_pair_stats),
      include_in_lineup_stats: fromDbBool(matchRow.include_in_lineup_stats),
      include_in_for_fun_stats: fromDbBool(matchRow.include_in_for_fun_stats),
      exclude_reason: matchRow.exclude_reason,
    },
    players: playerRows.map(toPlayerDraft),
    field_confidence: {
      players: fieldConfidencePlayers,
    },
    codex_notes: [],
  };
}

function toMatchSummary(row) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    local_match_no: localMatchNo(row),
    status: "imported",
    played_at: row.played_at,
    mode: row.mode,
    friend_result: row.friend_result,
    friend_side: row.friend_side,
    score: `${row.blue_score}:${row.red_score}`,
    friend_count: row.friend_count,
    updated_at: row.updated_at,
  };
}

function toMatchDetail(db, row) {
  if (!row) {
    return null;
  }

  const playerRows = listPlayerRows(db, row.id);
  const screenshots = listScreenshotPaths(db, row.id);

  return {
    ...toMatchSummary(row),
    review_match_id: row.review_match_id,
    overview_path: screenshots.overview ?? null,
    detail_path: screenshots.detail ?? null,
    dedupe_key: row.dedupe_key,
    dedupe_override_reason: row.dedupe_override_reason,
    normalized_json: toNormalizedJson(db, row, playerRows),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function changedMatchFields(beforeJson, afterJson) {
  const changes = {};

  for (const field of matchFields) {
    if (!sameJson(beforeJson.match?.[field], afterJson.match?.[field])) {
      changes[field] = {
        from: beforeJson.match?.[field] ?? null,
        to: afterJson.match?.[field] ?? null,
      };
    }
  }

  return changes;
}

function playerKey(player) {
  return `${player.side}:${player.slot}`;
}

function changedPlayerFields(beforeJson, afterJson) {
  const beforePlayers = new Map((beforeJson.players ?? []).map((player) => [playerKey(player), player]));
  const changedPlayers = [];

  for (const player of afterJson.players ?? []) {
    const beforePlayer = beforePlayers.get(playerKey(player)) ?? {};
    const fields = {};

    for (const field of playerFields) {
      if (!sameJson(beforePlayer[field], player[field])) {
        fields[field] = {
          from: beforePlayer[field] ?? null,
          to: player[field] ?? null,
        };
      }
    }

    if (Object.keys(fields).length > 0) {
      changedPlayers.push({
        side: player.side,
        slot: player.slot,
        fields,
      });
    }
  }

  return changedPlayers;
}

function buildChangedFields(beforeJson, afterJson) {
  const changedFields = {};
  const matchChanges = changedMatchFields(beforeJson, afterJson);
  const playerChanges = changedPlayerFields(beforeJson, afterJson);

  if (Object.keys(matchChanges).length > 0) {
    changedFields.match = matchChanges;
  }

  if (playerChanges.length > 0) {
    changedFields.players = playerChanges;
  }

  return changedFields;
}

function writeImportedMatchRows(db, matchRow, normalizedJson, friendIdsByName, timestamp) {
  const matchId = matchRow.id;
  const dedupeKey = createDedupeKey(normalizedJson, friendIdsByName);
  const matchPlayers = normalizedJson.players.map((player) => {
    const playerId = resolveFriendId(friendIdsByName, player);

    return {
      ...player,
      id: `${matchId}:${player.side}:${player.slot}`,
      player_id: playerId,
      is_friend: Boolean(playerId),
    };
  });
  const friendCount = matchPlayers.filter((player) => player.is_friend).length;

  db.prepare(
    `
      UPDATE matches
      SET
        mode = ?,
        played_at = ?,
        duration_seconds = ?,
        blue_score = ?,
        red_score = ?,
        winner_side = ?,
        friend_side = ?,
        friend_result = ?,
        friend_count = ?,
        include_in_personal_stats = ?,
        include_in_pair_stats = ?,
        include_in_lineup_stats = ?,
        include_in_for_fun_stats = ?,
        exclude_reason = ?,
        dedupe_key = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    normalizedJson.match.mode,
    normalizedJson.match.played_at,
    normalizedJson.match.duration_seconds,
    normalizedJson.match.blue_score,
    normalizedJson.match.red_score,
    normalizedJson.match.winner_side,
    normalizedJson.match.friend_side,
    normalizedJson.match.friend_result,
    friendCount,
    toDbBool(normalizedJson.match.include_in_personal_stats),
    toDbBool(normalizedJson.match.include_in_pair_stats),
    toDbBool(normalizedJson.match.include_in_lineup_stats),
    toDbBool(normalizedJson.match.include_in_for_fun_stats),
    normalizedJson.match.exclude_reason,
    dedupeKey,
    timestamp,
    matchId,
  );

  db.prepare("DELETE FROM match_players WHERE match_id = ?").run(matchId);

  const insertPlayer = db.prepare(
    `
      INSERT INTO match_players (
        id,
        match_id,
        player_id,
        raw_name,
        side,
        slot,
        is_friend,
        raw_hero,
        hero_id,
        hero_name,
        lane,
        lane_source,
        lane_confidence,
        rating,
        kills,
        deaths,
        assists,
        economy,
        damage_dealt,
        damage_dealt_pct,
        damage_taken,
        damage_taken_pct,
        team_economy_pct,
        participation_pct,
        medals_json,
        is_mvp,
        is_svp,
        field_sources_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (const player of matchPlayers) {
    insertPlayer.run(
      player.id,
      matchId,
      player.player_id,
      player.raw_name,
      player.side,
      player.slot,
      toDbBool(player.is_friend),
      player.raw_hero,
      player.hero_id,
      player.hero_name,
      player.lane,
      player.lane_source,
      player.lane_confidence,
      player.rating,
      player.kills,
      player.deaths,
      player.assists,
      player.economy,
      player.damage_dealt,
      player.damage_dealt_pct,
      player.damage_taken,
      player.damage_taken_pct,
      player.team_economy_pct,
      player.participation_pct,
      JSON.stringify(player.medals ?? []),
      toDbBool(player.is_mvp),
      toDbBool(player.is_svp),
      toJson(normalizedJson.field_confidence?.players?.[player.side]?.[player.slot]),
    );
  }

  return {
    dedupe_key: dedupeKey,
    friend_count: friendCount,
  };
}

export function listImportedMatches(db) {
  return db
    .prepare(
      `
        SELECT
          matches.id,
          matches.batch_id,
          matches.review_match_id,
          matches.mode,
          matches.played_at,
          matches.blue_score,
          matches.red_score,
          matches.friend_side,
          matches.friend_result,
          matches.friend_count,
          matches.updated_at,
          review_matches.local_match_no
        FROM matches
        LEFT JOIN review_matches
          ON review_matches.id = matches.review_match_id
        ORDER BY matches.played_at DESC, matches.id ASC
      `,
    )
    .all()
    .map(toMatchSummary);
}

export function getImportedMatch(db, id) {
  return toMatchDetail(db, getMatchRow(db, id));
}

export function getImportedMatchScreenshotPath(db, id, screenshotType) {
  if (!["overview", "detail"].includes(screenshotType)) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT local_path
        FROM screenshots
        WHERE match_id = ?
          AND screenshot_type = ?
      `,
    )
    .get(id, screenshotType);

  return row?.local_path ?? null;
}

export function updateImportedMatch(db, id, normalizedJson) {
  const matchRow = getMatchRow(db, id);

  if (!matchRow) {
    return null;
  }

  const friendRecordsByName = loadFriendRecordsByName(db);
  const friendIdsByName = loadFriendIdsByName(db);
  const normalizedReviewJson = normalizeKnownFriendCandidates(normalizedJson, friendRecordsByName);

  validateApprovableReview(normalizedReviewJson, friendIdsByName);

  const beforeMatch = getImportedMatch(db, id);
  const timestamp = new Date().toISOString();
  let updateResult;

  db.exec("BEGIN IMMEDIATE");

  try {
    updateResult = writeImportedMatchRows(
      db,
      matchRow,
      normalizedReviewJson,
      friendIdsByName,
      timestamp,
    );

    insertReviewEvent(db, {
      targetType: "match",
      targetId: id,
      action: "edit",
      changedFields: {
        ...buildChangedFields(beforeMatch.normalized_json, normalizedReviewJson),
        dedupe_key: updateResult.dedupe_key,
      },
      timestamp,
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    match: getImportedMatch(db, id),
    dedupe_key: updateResult.dedupe_key,
  };
}

export function updateImportedMatchFromReview(db, reviewMatchId, matchId) {
  const reviewRow = db
    .prepare(
      `
        SELECT id, batch_id, normalized_json, status
        FROM review_matches
        WHERE id = ?
      `,
    )
    .get(reviewMatchId);

  if (!reviewRow) {
    return null;
  }

  if (reviewRow.status === "imported") {
    throw new Error("Imported review match cannot update an existing match");
  }

  if (reviewRow.status === "rejected") {
    throw new Error("Rejected review match cannot update an existing match");
  }

  const matchRow = getMatchRow(db, matchId);

  if (!matchRow) {
    throw new Error("Existing match not found");
  }

  const friendRecordsByName = loadFriendRecordsByName(db);
  const friendIdsByName = loadFriendIdsByName(db);
  const normalizedJson = normalizeKnownFriendCandidates(
    parseJsonField(reviewRow.normalized_json, {}),
    friendRecordsByName,
  );

  validateApprovableReview(normalizedJson, friendIdsByName);

  const beforeMatch = getImportedMatch(db, matchId);
  const timestamp = new Date().toISOString();
  let updateResult;

  db.exec("BEGIN IMMEDIATE");

  try {
    updateResult = writeImportedMatchRows(db, matchRow, normalizedJson, friendIdsByName, timestamp);

    insertReviewEvent(db, {
      targetType: "match",
      targetId: matchId,
      action: "edit",
      changedFields: {
        ...buildChangedFields(beforeMatch.normalized_json, normalizedJson),
        dedupe_key: updateResult.dedupe_key,
        source_review_match_id: reviewRow.id,
      },
      note: `用待审局 ${reviewRow.id} 修正已有对局`,
      timestamp,
    });

    db.prepare(
      `
        UPDATE review_matches
        SET status = 'rejected', updated_at = ?
        WHERE id = ?
      `,
    ).run(timestamp, reviewRow.id);

    insertReviewEvent(db, {
      targetType: "review_match",
      targetId: reviewRow.id,
      action: "reject",
      changedFields: {
        status: {
          from: reviewRow.status,
          to: "rejected",
        },
        updated_match_id: matchId,
      },
      note: `已用于修正 ${matchId}`,
      timestamp,
    });

    updateBatchStatus(db, reviewRow.batch_id, timestamp);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    match: getImportedMatch(db, matchId),
    review_match: getReviewMatch(db, reviewRow.id),
    dedupe_key: updateResult.dedupe_key,
  };
}

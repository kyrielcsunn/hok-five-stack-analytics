import { randomUUID } from "node:crypto";
import { findDedupeConflicts } from "./dedupe.js";
import { assertValidReviewJson } from "./review-json.js";
import { getReviewMatch } from "./review-matches.js";

export class DedupeConflictError extends Error {
  constructor(dedupe) {
    super("Review match looks like an existing imported match");
    this.name = "DedupeConflictError";
    this.dedupe = dedupe;
  }
}

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function requireString(errors, value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} is required`);
  }
}

function requireInteger(errors, value, path) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} is required`);
  }
}

function requireNumber(errors, value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} is required`);
  }
}

function requireBoolean(errors, value, path) {
  if (typeof value !== "boolean") {
    errors.push(`${path} is required`);
  }
}

export function validateApprovableReview(normalizedJson, friendIdsByName) {
  assertValidReviewJson(normalizedJson, "normalized review JSON");

  const errors = [];
  const { match, players } = normalizedJson;
  const statSwitches = [
    "include_in_personal_stats",
    "include_in_pair_stats",
    "include_in_lineup_stats",
    "include_in_for_fun_stats",
  ];

  requireString(errors, match.mode, "match.mode");
  requireString(errors, match.played_at, "match.played_at");
  requireInteger(errors, match.blue_score, "match.blue_score");
  requireInteger(errors, match.red_score, "match.red_score");
  requireString(errors, match.winner_side, "match.winner_side");
  requireString(errors, match.friend_side, "match.friend_side");
  requireString(errors, match.friend_result, "match.friend_result");

  for (const field of statSwitches) {
    requireBoolean(errors, match[field], `match.${field}`);
  }

  if (!statSwitches.some((field) => match[field]) && !match.exclude_reason?.trim()) {
    errors.push("match.exclude_reason is required when all stat switches are disabled");
  }

  const friendPlayers = [];
  const seenFriendIds = new Set();
  const seenFriendLanes = new Set();

  players.forEach((player, index) => {
    const path = `players[${index}]`;

    requireString(errors, player.raw_name, `players[${index}].raw_name`);

    if (!player.is_friend_candidate) {
      return;
    }

    if (player.side !== match.friend_side) {
      errors.push(`${path}.side must match match.friend_side for friend players`);
      return;
    }

    const friendId = resolveFriendId(friendIdsByName, player);

    if (!friendId) {
      errors.push(`${path}.friend_candidate must match a known friend`);
      return;
    }

    if (seenFriendIds.has(friendId)) {
      errors.push(`${path}.friend_candidate duplicates another friend player`);
    }

    seenFriendIds.add(friendId);
    friendPlayers.push({ player, index });
  });

  if (friendPlayers.length < 3 || friendPlayers.length > 5) {
    errors.push("match.friend_side must contain 3 to 5 known friend players");
  }

  for (const { player, index } of friendPlayers) {
    const path = `players[${index}]`;

    requireString(errors, player.hero_id, `${path}.hero_id`);
    requireString(errors, player.hero_name, `${path}.hero_name`);
    requireString(errors, player.lane, `${path}.lane`);
    requireString(errors, player.lane_source, `${path}.lane_source`);
    requireString(errors, player.lane_confidence, `${path}.lane_confidence`);
    requireNumber(errors, player.rating, `${path}.rating`);
    requireInteger(errors, player.kills, `${path}.kills`);
    requireInteger(errors, player.deaths, `${path}.deaths`);
    requireInteger(errors, player.assists, `${path}.assists`);

    if (player.lane) {
      if (seenFriendLanes.has(player.lane)) {
        errors.push(`${path}.lane duplicates another friend player lane`);
      }

      seenFriendLanes.add(player.lane);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Review match cannot be approved:\n- ${errors.join("\n- ")}`);
  }
}

export function toDbBool(value) {
  return value ? 1 : 0;
}

export function toJson(value) {
  return JSON.stringify(value ?? {});
}

export function loadFriendIdsByName(db) {
  return new Map(
    Array.from(loadFriendRecordsByName(db), ([name, friend]) => [name, friend.id]),
  );
}

export function loadFriendRecordsByName(db) {
  const friends = db
    .prepare(
      `
        SELECT id, display_name, game_nickname, aliases_json
        FROM players
        WHERE is_friend = 1
      `,
    )
    .all();
  const friendsByName = new Map();

  for (const friend of friends) {
    const record = {
      id: friend.id,
      display_name: friend.display_name,
    };

    friendsByName.set(friend.display_name, record);
    friendsByName.set(friend.game_nickname, record);

    for (const alias of JSON.parse(friend.aliases_json)) {
      friendsByName.set(alias, record);
    }
  }

  return friendsByName;
}

export function normalizeKnownFriendCandidates(normalizedJson, friendRecordsByName) {
  const friendSide = normalizedJson.match?.friend_side ?? null;
  let changed = false;

  const players = normalizedJson.players.map((player) => {
    const matchedFriend =
      friendRecordsByName.get(player.friend_candidate) ?? friendRecordsByName.get(player.raw_name);

    if (!matchedFriend) {
      return player;
    }

    if (!player.is_friend_candidate && friendSide && player.side !== friendSide) {
      return player;
    }

    if (
      player.is_friend_candidate === true &&
      player.friend_candidate === matchedFriend.display_name
    ) {
      return player;
    }

    changed = true;

    return {
      ...player,
      friend_candidate: matchedFriend.display_name,
      is_friend_candidate: true,
    };
  });

  if (!changed) {
    return normalizedJson;
  }

  return {
    ...normalizedJson,
    players,
  };
}

export function resolveFriendId(idsByName, player) {
  if (!player.is_friend_candidate) {
    return null;
  }

  return idsByName.get(player.friend_candidate) ?? idsByName.get(player.raw_name) ?? null;
}

export function updateBatchStatus(db, batchId, timestamp) {
  const statuses = db
    .prepare(
      `
        SELECT status, COUNT(*) AS count
        FROM review_matches
        WHERE batch_id = ?
        GROUP BY status
      `,
    )
    .all(batchId);
  const total = statuses.reduce((sum, row) => sum + row.count, 0);
  const imported = statuses
    .filter((row) => row.status === "imported")
    .reduce((sum, row) => sum + row.count, 0);
  const status = imported === total ? "imported" : imported > 0 ? "partially_imported" : "reviewing";

  db.prepare(
    `
      UPDATE import_batches
      SET status = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(status, timestamp, batchId);
}

export function insertReviewEvent(
  db,
  { targetType = "review_match", targetId, action, changedFields, note, timestamp },
) {
  db.prepare(
    `
      INSERT INTO review_events (
        id,
        target_type,
        target_id,
        action,
        changed_fields_json,
        note,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `review-event:${randomUUID()}`,
    targetType,
    targetId,
    action,
    JSON.stringify(changedFields ?? {}, null, 2),
    note ?? null,
    timestamp,
  );
}

export function approveReviewMatch(db, id) {
  return approveReviewMatchWithOptions(db, id);
}

export function approveReviewMatchWithOptions(db, id, options = {}) {
  const row = db
    .prepare(
      `
        SELECT id, batch_id, normalized_json, status
        FROM review_matches
        WHERE id = ?
      `,
    )
    .get(id);

  if (!row) {
    return null;
  }

  if (row.status === "imported") {
    throw new Error("Review match is already imported");
  }

  if (row.status === "rejected") {
    throw new Error("Rejected review match cannot be approved");
  }

  const existingMatch = db
    .prepare("SELECT id FROM matches WHERE review_match_id = ?")
    .get(id);

  if (existingMatch) {
    throw new Error("Review match already has an imported match");
  }

  const friendRecordsByName = loadFriendRecordsByName(db);
  const friendIdsByName = loadFriendIdsByName(db);
  const normalizedJson = normalizeKnownFriendCandidates(
    parseJsonField(row.normalized_json, {}),
    friendRecordsByName,
  );

  validateApprovableReview(normalizedJson, friendIdsByName);

  const timestamp = new Date().toISOString();
  const matchId = `match:${id}`;
  const dedupe = findDedupeConflicts(db, normalizedJson, friendIdsByName);
  const overrideReason =
    typeof options?.dedupe_override_reason === "string"
      ? options.dedupe_override_reason.trim() || null
      : null;

  if (dedupe.conflicts.length > 0 && !overrideReason) {
    throw new DedupeConflictError(dedupe);
  }

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

  db.exec("BEGIN IMMEDIATE");

  try {
    db.prepare(
      `
        INSERT INTO matches (
          id,
          batch_id,
          review_match_id,
          mode,
          played_at,
          duration_seconds,
          blue_score,
          red_score,
          winner_side,
          friend_side,
          friend_result,
          friend_count,
          include_in_personal_stats,
          include_in_pair_stats,
          include_in_lineup_stats,
          include_in_for_fun_stats,
          exclude_reason,
          dedupe_key,
          dedupe_override_reason,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      matchId,
      normalizedJson.source.batch_id,
      row.id,
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
      dedupe.dedupe_key,
      overrideReason,
      timestamp,
      timestamp,
    );

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

    db.prepare(
      `
        UPDATE screenshots
        SET match_id = ?
        WHERE id IN (
          SELECT overview_screenshot_id FROM review_matches WHERE id = ?
          UNION
          SELECT detail_screenshot_id FROM review_matches WHERE id = ?
        )
      `,
    ).run(matchId, row.id, row.id);

    db.prepare(
      `
        UPDATE review_matches
        SET status = 'imported', updated_at = ?
        WHERE id = ?
      `,
    ).run(timestamp, row.id);

    insertReviewEvent(db, {
      targetId: row.id,
      action: "approve",
      changedFields: {
        status: {
          from: row.status,
          to: "imported",
        },
        match_id: matchId,
        dedupe_key: dedupe.dedupe_key,
      },
      timestamp,
    });

    if (dedupe.conflicts.length > 0 && overrideReason) {
      insertReviewEvent(db, {
        targetId: row.id,
        action: "dedupe_override",
        changedFields: {
          match_id: matchId,
          dedupe_key: dedupe.dedupe_key,
          conflicts: dedupe.conflicts.map((conflict) => ({
            type: conflict.type,
            match_id: conflict.match_id,
          })),
        },
        note: overrideReason,
        timestamp,
      });
    }

    updateBatchStatus(db, row.batch_id, timestamp);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    match_id: matchId,
    dedupe,
    review_match: getReviewMatch(db, row.id),
  };
}

export function rejectReviewMatch(db, id) {
  const row = db
    .prepare(
      `
        SELECT id, batch_id, status
        FROM review_matches
        WHERE id = ?
      `,
    )
    .get(id);

  if (!row) {
    return null;
  }

  if (row.status === "imported") {
    throw new Error("Imported review match cannot be rejected");
  }

  if (row.status === "rejected") {
    return {
      review_match: getReviewMatch(db, row.id),
    };
  }

  const timestamp = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");

  try {
    db.prepare(
      `
        UPDATE review_matches
        SET status = 'rejected', updated_at = ?
        WHERE id = ?
      `,
    ).run(timestamp, row.id);

    insertReviewEvent(db, {
      targetId: row.id,
      action: "reject",
      changedFields: {
        status: {
          from: row.status,
          to: "rejected",
        },
      },
      timestamp,
    });
    updateBatchStatus(db, row.batch_id, timestamp);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    review_match: getReviewMatch(db, row.id),
  };
}

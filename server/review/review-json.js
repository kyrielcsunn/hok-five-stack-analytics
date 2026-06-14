import { readFileSync } from "node:fs";

const sides = new Set(["blue", "red"]);
const results = new Set(["win", "loss"]);
const lanes = new Set(["对抗路", "中路", "打野", "发育路", "游走"]);
const laneSources = new Set(["medal", "manual", "hero_default", "manual_guess"]);
const laneConfidences = new Set(["high", "medium", "low"]);

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
  "side",
  "slot",
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequiredObject(errors, value, path) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  return true;
}

function validateNoMissingKeys(errors, value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
}

function validateNoExtraKeys(errors, value, keys, path) {
  const allowedKeys = new Set(keys);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
}

function validateNullableString(errors, value, path) {
  if (value !== null && typeof value !== "string") {
    errors.push(`${path} must be a string or null`);
  }
}

function validateNullableNumber(errors, value, path) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${path} must be a finite number or null`);
  }
}

function validateNullableInteger(errors, value, path) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    errors.push(`${path} must be a non-negative integer or null`);
  }
}

function validateNullableBoolean(errors, value, path) {
  if (value !== null && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean or null`);
  }
}

function validateNullableEnum(errors, value, allowed, path) {
  if (value !== null && !allowed.has(value)) {
    errors.push(`${path} must be one of ${Array.from(allowed).join(", ")} or null`);
  }
}

function validateSource(errors, source) {
  if (!validateRequiredObject(errors, source, "source")) {
    return;
  }

  validateNoMissingKeys(errors, source, ["batch_id", "local_match_no", "overview_path", "detail_path"], "source");
  validateNoExtraKeys(errors, source, ["batch_id", "local_match_no", "overview_path", "detail_path"], "source");

  for (const key of ["batch_id", "local_match_no", "overview_path", "detail_path"]) {
    if (Object.hasOwn(source, key) && !isNonEmptyString(source[key])) {
      errors.push(`source.${key} must be a non-empty string`);
    }
  }
}

function validateMatch(errors, match) {
  if (!validateRequiredObject(errors, match, "match")) {
    return;
  }

  validateNoMissingKeys(errors, match, matchFields, "match");
  validateNoExtraKeys(errors, match, matchFields, "match");
  validateNullableString(errors, match.mode, "match.mode");
  validateNullableString(errors, match.played_at, "match.played_at");

  if (typeof match.played_at === "string" && Number.isNaN(Date.parse(match.played_at))) {
    errors.push("match.played_at must be an ISO-compatible date-time string or null");
  }

  validateNullableInteger(errors, match.duration_seconds, "match.duration_seconds");
  validateNullableInteger(errors, match.blue_score, "match.blue_score");
  validateNullableInteger(errors, match.red_score, "match.red_score");
  validateNullableEnum(errors, match.winner_side, sides, "match.winner_side");
  validateNullableEnum(errors, match.friend_side, sides, "match.friend_side");
  validateNullableEnum(errors, match.friend_result, results, "match.friend_result");

  for (const key of [
    "include_in_personal_stats",
    "include_in_pair_stats",
    "include_in_lineup_stats",
    "include_in_for_fun_stats",
  ]) {
    validateNullableBoolean(errors, match[key], `match.${key}`);
  }

  validateNullableString(errors, match.exclude_reason, "match.exclude_reason");
}

function validatePlayer(errors, player, index) {
  const path = `players[${index}]`;

  if (!validateRequiredObject(errors, player, path)) {
    return;
  }

  validateNoMissingKeys(errors, player, playerFields, path);
  validateNoExtraKeys(errors, player, playerFields, path);

  if (!sides.has(player.side)) {
    errors.push(`${path}.side must be blue or red`);
  }

  if (!Number.isInteger(player.slot) || player.slot < 1 || player.slot > 5) {
    errors.push(`${path}.slot must be an integer between 1 and 5`);
  }

  for (const key of ["raw_name", "friend_candidate", "raw_hero", "hero_id", "hero_name"]) {
    validateNullableString(errors, player[key], `${path}.${key}`);
  }

  validateNullableBoolean(errors, player.is_friend_candidate, `${path}.is_friend_candidate`);
  validateNullableNumber(errors, player.rating, `${path}.rating`);

  for (const key of ["kills", "deaths", "assists", "economy", "damage_dealt", "damage_taken"]) {
    validateNullableInteger(errors, player[key], `${path}.${key}`);
  }

  for (const key of ["damage_dealt_pct", "damage_taken_pct", "team_economy_pct", "participation_pct"]) {
    validateNullableNumber(errors, player[key], `${path}.${key}`);
  }

  if (!Array.isArray(player.medals) || player.medals.some((medal) => typeof medal !== "string")) {
    errors.push(`${path}.medals must be an array of strings`);
  }

  validateNullableEnum(errors, player.lane, lanes, `${path}.lane`);
  validateNullableEnum(errors, player.lane_source, laneSources, `${path}.lane_source`);
  validateNullableEnum(errors, player.lane_confidence, laneConfidences, `${path}.lane_confidence`);
  validateNullableBoolean(errors, player.is_mvp, `${path}.is_mvp`);
  validateNullableBoolean(errors, player.is_svp, `${path}.is_svp`);
}

function validatePlayers(errors, players) {
  if (!Array.isArray(players)) {
    errors.push("players must be an array");
    return;
  }

  if (players.length !== 10) {
    errors.push("players must contain exactly 10 rows");
  }

  const seenSlots = new Set();

  players.forEach((player, index) => {
    validatePlayer(errors, player, index);

    if (isRecord(player) && sides.has(player.side) && Number.isInteger(player.slot)) {
      const slotKey = `${player.side}:${player.slot}`;

      if (seenSlots.has(slotKey)) {
        errors.push(`players must not contain duplicate side/slot ${slotKey}`);
      }

      seenSlots.add(slotKey);
    }
  });

  for (const side of sides) {
    for (let slot = 1; slot <= 5; slot += 1) {
      const slotKey = `${side}:${slot}`;

      if (!seenSlots.has(slotKey)) {
        errors.push(`players is missing ${slotKey}`);
      }
    }
  }
}

export function readReviewJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON syntax in ${filePath}: ${error.message}`);
  }
}

export function validateReviewJson(reviewJson) {
  const errors = [];

  if (!validateRequiredObject(errors, reviewJson, "review")) {
    return errors;
  }

  validateNoMissingKeys(errors, reviewJson, ["source", "match", "players"], "review");
  validateNoExtraKeys(
    errors,
    reviewJson,
    ["source", "match", "players", "field_confidence", "codex_notes"],
    "review",
  );
  validateSource(errors, reviewJson.source);
  validateMatch(errors, reviewJson.match);
  validatePlayers(errors, reviewJson.players);

  if (
    Object.hasOwn(reviewJson, "field_confidence") &&
    !isRecord(reviewJson.field_confidence)
  ) {
    errors.push("field_confidence must be an object when present");
  }

  if (
    Object.hasOwn(reviewJson, "codex_notes") &&
    (!Array.isArray(reviewJson.codex_notes) ||
      reviewJson.codex_notes.some((note) => typeof note !== "string"))
  ) {
    errors.push("codex_notes must be an array of strings when present");
  }

  return errors;
}

export function assertValidReviewJson(reviewJson, label = "review JSON") {
  const errors = validateReviewJson(reviewJson);

  if (errors.length > 0) {
    throw new Error(`${label} failed validation:\n- ${errors.join("\n- ")}`);
  }
}

export function normalizeReviewJson(reviewJson) {
  assertValidReviewJson(reviewJson);

  return {
    source: {
      batch_id: reviewJson.source.batch_id.trim(),
      local_match_no: reviewJson.source.local_match_no.trim(),
      overview_path: reviewJson.source.overview_path.trim(),
      detail_path: reviewJson.source.detail_path.trim(),
    },
    match: Object.fromEntries(matchFields.map((field) => [field, reviewJson.match[field]])),
    players: reviewJson.players.map((player) =>
      Object.fromEntries(playerFields.map((field) => [field, player[field]])),
    ),
    field_confidence: reviewJson.field_confidence ?? {},
    codex_notes: reviewJson.codex_notes ?? [],
  };
}

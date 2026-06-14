import { assertValidReviewJson } from "./review-json.js";

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function toReviewMatchSummary(row) {
  const normalizedJson = parseJsonField(row.normalized_json, {});
  const match = normalizedJson.match ?? {};
  const players = normalizedJson.players ?? [];
  const friendCount = players.filter((player) => player.is_friend_candidate).length;

  return {
    id: row.id,
    batch_id: row.batch_id,
    local_match_no: row.local_match_no,
    status: row.status,
    played_at: match.played_at ?? null,
    mode: match.mode ?? null,
    friend_result: match.friend_result ?? null,
    friend_side: match.friend_side ?? null,
    score:
      match.blue_score === null || match.red_score === null
        ? null
        : `${match.blue_score}:${match.red_score}`,
    friend_count: friendCount,
    updated_at: row.updated_at,
  };
}

function toReviewMatchDetail(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    batch_id: row.batch_id,
    local_match_no: row.local_match_no,
    status: row.status,
    overview_screenshot_id: row.overview_screenshot_id,
    detail_screenshot_id: row.detail_screenshot_id,
    overview_path: row.overview_path,
    detail_path: row.detail_path,
    raw_review_json: parseJsonField(row.raw_review_json, {}),
    normalized_json: parseJsonField(row.normalized_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listReviewMatches(db) {
  return db
    .prepare(
      `
        SELECT id, batch_id, local_match_no, normalized_json, status, updated_at
        FROM review_matches
        ORDER BY batch_id DESC, local_match_no ASC
      `,
    )
    .all()
    .map(toReviewMatchSummary);
}

export function getReviewMatch(db, id) {
  const row = db
    .prepare(
      `
        SELECT
          review_matches.id,
          review_matches.batch_id,
          review_matches.local_match_no,
          review_matches.overview_screenshot_id,
          review_matches.detail_screenshot_id,
          review_matches.raw_review_json,
          review_matches.normalized_json,
          review_matches.status,
          review_matches.created_at,
          review_matches.updated_at,
          overview.local_path AS overview_path,
          detail.local_path AS detail_path
        FROM review_matches
        LEFT JOIN screenshots AS overview
          ON overview.id = review_matches.overview_screenshot_id
        LEFT JOIN screenshots AS detail
          ON detail.id = review_matches.detail_screenshot_id
        WHERE review_matches.id = ?
      `,
    )
    .get(id);

  return toReviewMatchDetail(row);
}

export function getReviewMatchScreenshotPath(db, id, screenshotType) {
  if (!["overview", "detail"].includes(screenshotType)) {
    return null;
  }

  const screenshotColumn =
    screenshotType === "overview" ? "overview_screenshot_id" : "detail_screenshot_id";
  const row = db
    .prepare(
      `
        SELECT screenshots.local_path
        FROM review_matches
        INNER JOIN screenshots
          ON screenshots.id = review_matches.${screenshotColumn}
        WHERE review_matches.id = ?
      `,
    )
    .get(id);

  return row?.local_path ?? null;
}

export function updateReviewMatchDraft(db, id, normalizedJson) {
  assertValidReviewJson(normalizedJson, "normalized review JSON");

  const timestamp = new Date().toISOString();
  const result = db
    .prepare(
      `
        UPDATE review_matches
        SET normalized_json = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(JSON.stringify(normalizedJson, null, 2), timestamp, id);

  if (result.changes === 0) {
    return null;
  }

  return getReviewMatch(db, id);
}

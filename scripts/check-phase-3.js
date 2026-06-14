import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import {
  importReviewJsonFiles,
  resolveReviewJsonInputPaths,
} from "./import-review-json.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const examplesDir = join(projectRoot, "specs", "examples", "review-json", "batch-001", "matches");
const tempDir = await mkdtemp(join(tmpdir(), "hok-phase3-"));
const dbPath = join(tempDir, "phase3.sqlite");
const missedFriendReviewPath = join(tempDir, "098.review.json");

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

const db = await initializeDatabase(dbPath);

try {
  seedFriends(db);

  const reviewJsonFiles = resolveReviewJsonInputPaths([examplesDir]);
  const imported = await importReviewJsonFiles(db, reviewJsonFiles);

  assert.equal(imported.length, 2);
  assert.equal(countRows(db, "import_batches"), 1);
  assert.equal(countRows(db, "screenshots"), 4);
  assert.equal(countRows(db, "review_matches"), 2);

  const reviewRows = db
    .prepare(
      `
        SELECT id, raw_review_json, normalized_json, status
        FROM review_matches
        ORDER BY local_match_no
      `,
    )
    .all();

  for (const row of reviewRows) {
    const rawReviewJson = JSON.parse(row.raw_review_json);
    const normalizedJson = JSON.parse(row.normalized_json);

    assert.equal(row.status, "pending_review");
    assert.ok(rawReviewJson.source.batch_id);
    assert.equal(normalizedJson.players.length, 10);
  }

  const missedFriendReview = JSON.parse(
    await readFile(join(examplesDir, "001.review.json"), "utf8"),
  );
  missedFriendReview.source.local_match_no = "098";
  missedFriendReview.source.overview_path = "data/screenshots/batch-001/098-overview.png";
  missedFriendReview.source.detail_path = "data/screenshots/batch-001/098-detail.png";
  const missedGe = missedFriendReview.players.find((player) => player.raw_name === "鸽");
  missedGe.friend_candidate = null;
  missedGe.is_friend_candidate = false;
  await writeFile(missedFriendReviewPath, JSON.stringify(missedFriendReview, null, 2));

  await importReviewJsonFiles(db, [missedFriendReviewPath]);
  const repairedReview = db
    .prepare("SELECT normalized_json FROM review_matches WHERE id = ?")
    .get("batch-001:098");
  const repairedGe = JSON.parse(repairedReview.normalized_json).players.find(
    (player) => player.raw_name === "鸽",
  );
  assert.equal(repairedGe.friend_candidate, "鸽");
  assert.equal(repairedGe.is_friend_candidate, true);

  const invalidReviewPath = join(tempDir, "invalid.review.json");
  await writeFile(
    invalidReviewPath,
    JSON.stringify(
      {
        source: {
          batch_id: "batch-invalid",
          local_match_no: "999",
          overview_path: "data/screenshots/batch-invalid/999-overview.png",
          detail_path: "data/screenshots/batch-invalid/999-detail.png",
        },
        match: {
          mode: "5v5排位",
          played_at: "2026-06-09T22:30:00+08:00",
          duration_seconds: 900,
          blue_score: 0,
          red_score: 0,
          winner_side: null,
          friend_side: null,
          friend_result: null,
          include_in_personal_stats: null,
          include_in_pair_stats: null,
          include_in_lineup_stats: null,
          include_in_for_fun_stats: null,
          exclude_reason: null,
        },
        players: [],
      },
      null,
      2,
    ),
  );

  await assert.rejects(
    () => importReviewJsonFiles(db, [invalidReviewPath]),
    /players must contain exactly 10 rows/,
  );
  assert.equal(countRows(db, "review_matches"), 3);

  console.log(
    JSON.stringify(
      {
        database: dbPath,
        imported_review_matches: countRows(db, "review_matches"),
        imported_screenshots: countRows(db, "screenshots"),
        repaired_known_friend_candidate: true,
        invalid_json_preserved_row_count: true,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
}

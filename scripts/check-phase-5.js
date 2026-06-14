import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import {
  DedupeConflictError,
  approveReviewMatch,
  approveReviewMatchWithOptions,
} from "../server/review/review-actions.js";
import {
  getImportedMatch,
  updateImportedMatch,
  updateImportedMatchFromReview,
} from "../server/review/imported-matches.js";
import { updateReviewMatchDraft } from "../server/review/review-matches.js";
import { importReviewJsonFiles } from "./import-review-json.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "hok-phase5-"));
const dbPath = join(tempDir, "phase5.sqlite");
const reviewPath = join(
  projectRoot,
  "specs",
  "examples",
  "review-json",
  "batch-001",
  "matches",
  "001.review.json",
);
const duplicateReviewPath = join(tempDir, "099.review.json");
const repairReviewPath = join(tempDir, "100.review.json");
const reviewMatchId = "batch-001:001";
const duplicateReviewMatchId = "batch-001:099";
const repairReviewMatchId = "batch-001:100";

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function loadNormalizedJson(db, id = reviewMatchId) {
  const row = db
    .prepare("SELECT normalized_json FROM review_matches WHERE id = ?")
    .get(id);

  return JSON.parse(row.normalized_json);
}

function standardizeFriendPlayers(reviewJson) {
  for (const player of reviewJson.players) {
    if (!player.is_friend_candidate) {
      continue;
    }

    player.hero_id ??= `manual:${player.side}:${player.slot}`;
    player.hero_name ??= player.raw_hero ?? "待确认英雄";
  }
}

const db = await initializeDatabase(dbPath);

try {
  seedFriends(db);
  await importReviewJsonFiles(db, [reviewPath]);

  assert.throws(
    () => approveReviewMatch(db, reviewMatchId),
    /players\[\d+\]\.hero_id is required/,
  );
  assert.equal(countRows(db, "matches"), 0);
  assert.equal(countRows(db, "match_players"), 0);

  const missingSwitchDraft = loadNormalizedJson(db);
  standardizeFriendPlayers(missingSwitchDraft);
  missingSwitchDraft.match.include_in_personal_stats = null;
  updateReviewMatchDraft(db, reviewMatchId, missingSwitchDraft);

  assert.throws(
    () => approveReviewMatch(db, reviewMatchId),
    /match\.include_in_personal_stats is required/,
  );
  assert.equal(countRows(db, "matches"), 0);
  assert.equal(countRows(db, "match_players"), 0);

  const approvableDraft = loadNormalizedJson(db);
  approvableDraft.match.include_in_personal_stats = true;
  approvableDraft.match.include_in_pair_stats = true;
  approvableDraft.match.include_in_lineup_stats = true;
  approvableDraft.match.include_in_for_fun_stats = true;
  approvableDraft.match.exclude_reason = null;
  updateReviewMatchDraft(db, reviewMatchId, approvableDraft);

  const approval = approveReviewMatch(db, reviewMatchId);
  assert.equal(approval.match_id, "match:batch-001:001");
  assert.equal(approval.review_match.status, "imported");

  const duplicateReview = JSON.parse(await readFile(reviewPath, "utf8"));
  duplicateReview.source.local_match_no = "099";
  duplicateReview.source.overview_path = "data/screenshots/batch-001/099-overview.png";
  duplicateReview.source.detail_path = "data/screenshots/batch-001/099-detail.png";
  await writeFile(duplicateReviewPath, JSON.stringify(duplicateReview, null, 2));
  await importReviewJsonFiles(db, [duplicateReviewPath]);

  const duplicateDraft = loadNormalizedJson(db, duplicateReviewMatchId);
  standardizeFriendPlayers(duplicateDraft);
  updateReviewMatchDraft(db, duplicateReviewMatchId, duplicateDraft);

  assert.throws(
    () => approveReviewMatch(db, duplicateReviewMatchId),
    (error) => error instanceof DedupeConflictError && error.dedupe.conflicts.length === 1,
  );

  const forcedApproval = approveReviewMatchWithOptions(db, duplicateReviewMatchId, {
    dedupe_override_reason: "Phase 5 duplicate check fixture",
  });
  assert.equal(forcedApproval.match_id, "match:batch-001:099");
  assert.equal(forcedApproval.dedupe.conflicts[0].match_id, "match:batch-001:001");

  const importedMatch = db
    .prepare(
      `
        SELECT
          friend_count,
          include_in_personal_stats,
          include_in_pair_stats,
          include_in_lineup_stats,
          include_in_for_fun_stats,
          exclude_reason,
          dedupe_key,
          dedupe_override_reason
        FROM matches
        WHERE id = ?
      `,
    )
    .get("match:batch-001:001");

  assert.equal(importedMatch.friend_count, 5);
  assert.equal(importedMatch.include_in_personal_stats, 1);
  assert.equal(importedMatch.include_in_pair_stats, 1);
  assert.equal(importedMatch.include_in_lineup_stats, 1);
  assert.equal(importedMatch.include_in_for_fun_stats, 1);
  assert.equal(importedMatch.exclude_reason, null);
  assert.match(importedMatch.dedupe_key, /^dedupe:v1:/);

  const forcedMatch = db
    .prepare("SELECT dedupe_key, dedupe_override_reason FROM matches WHERE id = ?")
    .get("match:batch-001:099");
  assert.equal(forcedMatch.dedupe_key, importedMatch.dedupe_key);
  assert.equal(forcedMatch.dedupe_override_reason, "Phase 5 duplicate check fixture");

  const overrideEvents = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM review_events
        WHERE target_id = ?
          AND action = 'dedupe_override'
      `,
    )
    .get(duplicateReviewMatchId);
  assert.equal(overrideEvents.count, 1);

  const importedDraft = getImportedMatch(db, "match:batch-001:001").normalized_json;
  importedDraft.match.mode = "5v5排位-编辑验证";
  importedDraft.players[0].rating = 15.8;

  const editedMatch = updateImportedMatch(db, "match:batch-001:001", importedDraft);
  assert.equal(editedMatch.match.normalized_json.match.mode, "5v5排位-编辑验证");
  assert.equal(editedMatch.match.normalized_json.players[0].rating, 15.8);

  const editEvents = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM review_events
        WHERE target_type = 'match'
          AND target_id = ?
          AND action = 'edit'
      `,
    )
    .get("match:batch-001:001");
  assert.equal(editEvents.count, 1);

  const repairReview = JSON.parse(await readFile(reviewPath, "utf8"));
  repairReview.source.local_match_no = "100";
  repairReview.source.overview_path = "data/screenshots/batch-001/100-overview.png";
  repairReview.source.detail_path = "data/screenshots/batch-001/100-detail.png";
  await writeFile(repairReviewPath, JSON.stringify(repairReview, null, 2));
  await importReviewJsonFiles(db, [repairReviewPath]);

  const repairDraft = loadNormalizedJson(db, repairReviewMatchId);
  standardizeFriendPlayers(repairDraft);
  repairDraft.players[0].rating = 16.2;
  updateReviewMatchDraft(db, repairReviewMatchId, repairDraft);

  const repairResult = updateImportedMatchFromReview(
    db,
    repairReviewMatchId,
    "match:batch-001:001",
  );
  assert.equal(repairResult.match.normalized_json.players[0].rating, 16.2);
  assert.equal(repairResult.review_match.status, "rejected");

  const repairEvents = db
    .prepare(
      `
        SELECT target_type, action
        FROM review_events
        WHERE target_id IN (?, ?)
        ORDER BY target_type, action
      `,
    )
    .all("match:batch-001:001", repairReviewMatchId);
  assert.deepEqual(repairEvents.map((event) => ({ ...event })), [
    {
      target_type: "match",
      action: "edit",
    },
    {
      target_type: "match",
      action: "edit",
    },
    {
      target_type: "review_match",
      action: "reject",
    },
  ]);

  const friendPlayerErrors = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM match_players
        WHERE is_friend = 1
          AND (
            hero_id IS NULL
            OR hero_name IS NULL
            OR lane IS NULL
            OR rating IS NULL
            OR kills IS NULL
            OR deaths IS NULL
            OR assists IS NULL
          )
      `,
    )
    .get();
  assert.equal(friendPlayerErrors.count, 0);

  console.log(
    JSON.stringify(
      {
        database: dbPath,
        rejected_missing_friend_hero: true,
        rejected_missing_stat_switch: true,
        approved_match: approval.match_id,
        duplicate_blocked: true,
        forced_duplicate_match: forcedApproval.match_id,
        edited_match: editedMatch.match.id,
        repaired_existing_match: repairResult.match.id,
        imported_friend_count: importedMatch.friend_count,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
}

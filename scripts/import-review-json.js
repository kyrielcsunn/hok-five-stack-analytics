import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { initializeDatabase, resolveDatabasePath } from "../server/db/database.js";
import {
  assertValidReviewJson,
  normalizeReviewJson,
  readReviewJsonFile,
} from "../server/review/review-json.js";
import {
  loadFriendRecordsByName,
  normalizeKnownFriendCandidates,
} from "../server/review/review-actions.js";

function collectReviewJsonFiles(inputPath) {
  const stat = statSync(inputPath);

  if (stat.isFile()) {
    return inputPath.endsWith(".review.json") ? [inputPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  return readdirSync(inputPath, { withFileTypes: true })
    .flatMap((entry) => collectReviewJsonFiles(join(inputPath, entry.name)))
    .sort();
}

function reviewMatchId(source) {
  return `${source.batch_id}:${source.local_match_no}`;
}

function screenshotId(source, screenshotType) {
  return `${source.batch_id}:${source.local_match_no}:${screenshotType}`;
}

function batchLocalDir(source) {
  return dirname(source.overview_path);
}

function loadReviewFiles(filePaths, friendRecordsByName) {
  return filePaths.map((filePath) => {
    const rawReviewJson = readReviewJsonFile(filePath);

    assertValidReviewJson(rawReviewJson, filePath);

    return {
      filePath,
      rawReviewJson,
      normalizedJson: normalizeKnownFriendCandidates(
        normalizeReviewJson(rawReviewJson),
        friendRecordsByName,
      ),
    };
  });
}

function importLoadedReviews(db, loadedReviews) {
  const timestamp = new Date().toISOString();
  const insertBatch = db.prepare(`
    INSERT INTO import_batches (id, local_dir, status, created_at, updated_at)
    VALUES (?, ?, 'reviewing', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      local_dir = excluded.local_dir,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
  const insertScreenshot = db.prepare(`
    INSERT INTO screenshots (
      id,
      batch_id,
      local_match_no,
      match_id,
      local_path,
      screenshot_type,
      ocr_status,
      created_at
    )
    VALUES (?, ?, ?, NULL, ?, ?, 'done', ?)
    ON CONFLICT(id) DO UPDATE SET
      batch_id = excluded.batch_id,
      local_match_no = excluded.local_match_no,
      local_path = excluded.local_path,
      screenshot_type = excluded.screenshot_type,
      ocr_status = excluded.ocr_status
  `);
  const insertReviewMatch = db.prepare(`
    INSERT INTO review_matches (
      id,
      batch_id,
      local_match_no,
      overview_screenshot_id,
      detail_screenshot_id,
      raw_review_json,
      normalized_json,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      batch_id = excluded.batch_id,
      local_match_no = excluded.local_match_no,
      overview_screenshot_id = excluded.overview_screenshot_id,
      detail_screenshot_id = excluded.detail_screenshot_id,
      raw_review_json = excluded.raw_review_json,
      normalized_json = excluded.normalized_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  const imported = [];

  db.exec("BEGIN IMMEDIATE");

  try {
    for (const loadedReview of loadedReviews) {
      const { source } = loadedReview.normalizedJson;
      const overviewScreenshotId = screenshotId(source, "overview");
      const detailScreenshotId = screenshotId(source, "detail");
      const id = reviewMatchId(source);

      insertBatch.run(source.batch_id, batchLocalDir(source), timestamp, timestamp);
      insertScreenshot.run(
        overviewScreenshotId,
        source.batch_id,
        source.local_match_no,
        source.overview_path,
        "overview",
        timestamp,
      );
      insertScreenshot.run(
        detailScreenshotId,
        source.batch_id,
        source.local_match_no,
        source.detail_path,
        "detail",
        timestamp,
      );
      insertReviewMatch.run(
        id,
        source.batch_id,
        source.local_match_no,
        overviewScreenshotId,
        detailScreenshotId,
        JSON.stringify(loadedReview.rawReviewJson, null, 2),
        JSON.stringify(loadedReview.normalizedJson, null, 2),
        timestamp,
        timestamp,
      );

      imported.push({
        id,
        batch_id: source.batch_id,
        local_match_no: source.local_match_no,
        file_path: loadedReview.filePath,
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return imported;
}

export async function importReviewJsonFiles(db, filePaths) {
  if (filePaths.length === 0) {
    throw new Error("No .review.json files were provided");
  }

  const friendRecordsByName = loadFriendRecordsByName(db);
  const loadedReviews = loadReviewFiles(filePaths, friendRecordsByName);

  return importLoadedReviews(db, loadedReviews);
}

export function resolveReviewJsonInputPaths(inputPaths) {
  const reviewJsonFiles = inputPaths.flatMap(collectReviewJsonFiles).sort();

  if (reviewJsonFiles.length === 0) {
    throw new Error("No .review.json files were found in the provided paths");
  }

  return reviewJsonFiles;
}

async function main() {
  const inputPaths = process.argv.slice(2);

  if (inputPaths.length === 0) {
    throw new Error("Usage: node scripts/import-review-json.js <file-or-directory> [...]");
  }

  const db = await initializeDatabase(resolveDatabasePath());

  try {
    const reviewJsonFiles = resolveReviewJsonInputPaths(inputPaths);
    const imported = await importReviewJsonFiles(db, reviewJsonFiles);

    console.log(
      JSON.stringify(
        {
          imported_count: imported.length,
          imported,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

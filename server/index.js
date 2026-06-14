import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "./db/database.js";
import { listFriends, seedFriends } from "./db/friends.js";
import { listHeroes, searchHeroes } from "./reference/heroes.js";
import {
  getImportedMatch,
  getImportedMatchScreenshotPath,
  listImportedMatches,
  updateImportedMatch,
  updateImportedMatchFromReview,
} from "./review/imported-matches.js";
import {
  DedupeConflictError,
  approveReviewMatchWithOptions,
  rejectReviewMatch,
} from "./review/review-actions.js";
import {
  getReviewMatch,
  getReviewMatchScreenshotPath,
  listReviewMatches,
  updateReviewMatchDraft,
} from "./review/review-matches.js";
import {
  createReportPeriod,
  createReportPeriodFromAllMatches,
  listReportPeriods,
} from "./reports/report-periods.js";
import { buildStaticExport } from "./reports/static-export.js";
import { calculateLeaderboards } from "./stats/leaderboards.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const db = await initializeDatabase();

seedFriends(db);

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON request body: ${error.message}`);
  }
}

async function readOptionalJsonBody(request) {
  const contentLength = Number.parseInt(request.headers["content-length"] ?? "0", 10);

  if (!contentLength && !request.headers["transfer-encoding"]) {
    return {};
  }

  return readJsonBody(request);
}

function getImageContentType(filePath) {
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    }[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

function sendLocalFile(response, localPath) {
  const absolutePath = resolve(projectRoot, localPath);
  const relativePath = relative(projectRoot, absolutePath);

  if (relativePath.startsWith("..") || relativePath === "") {
    sendJson(response, 400, {
      ok: false,
      error: "Invalid local file path",
    });
    return;
  }

  let fileStat;

  try {
    fileStat = statSync(absolutePath);
  } catch {
    sendJson(response, 404, {
      ok: false,
      error: "Screenshot file not found",
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": getImageContentType(absolutePath),
    "Content-Length": fileStat.size,
    "Cache-Control": "no-store",
  });
  createReadStream(absolutePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "hok-five-stack-api",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/friends") {
      sendJson(response, 200, {
        friends: listFriends(db),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/heroes") {
      const search = url.searchParams.get("search");

      sendJson(response, 200, {
        heroes: search ? searchHeroes(search) : listHeroes(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/review-matches") {
      sendJson(response, 200, {
        review_matches: listReviewMatches(db),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/matches") {
      sendJson(response, 200, {
        matches: listImportedMatches(db),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/leaderboards") {
      try {
        sendJson(response, 200, {
          leaderboards: calculateLeaderboards(db, {
            periodId: url.searchParams.get("period_id"),
          }),
        });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
      }

      return;
    }

    if (request.method === "GET" && url.pathname === "/report-periods") {
      sendJson(response, 200, {
        report_periods: listReportPeriods(db),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/report-periods") {
      let body;

      try {
        body = await readOptionalJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      try {
        const result = body.match_ids
          ? createReportPeriod(db, {
              id: body.id,
              name: body.name,
              description: body.description,
              matchIds: body.match_ids,
              sourceFilter: body.source_filter,
              replace: Boolean(body.replace),
            })
          : createReportPeriodFromAllMatches(db, {
              id: body.id,
              name: body.name,
              description: body.description,
              replace: Boolean(body.replace),
              sourceFilter: body.source_filter,
            });

        sendJson(response, 200, {
          ok: true,
          ...result,
        });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
      }

      return;
    }

    if (request.method === "GET" && url.pathname === "/static-export") {
      try {
        sendJson(response, 200, {
          export: buildStaticExport(db, {
            periodId: url.searchParams.get("period_id"),
          }),
        });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
      }

      return;
    }

    if (request.method === "GET" && pathParts[0] === "matches" && pathParts.length === 2) {
      const match = getImportedMatch(db, decodeURIComponent(pathParts[1]));

      if (!match) {
        sendJson(response, 404, {
          ok: false,
          error: "Match not found",
        });
        return;
      }

      sendJson(response, 200, {
        match,
      });
      return;
    }

    if (request.method === "PATCH" && pathParts[0] === "matches" && pathParts.length === 2) {
      let body;

      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!body || typeof body !== "object" || !body.normalized_json) {
        sendJson(response, 400, {
          ok: false,
          error: "normalized_json is required",
        });
        return;
      }

      let result;

      try {
        result = updateImportedMatch(db, decodeURIComponent(pathParts[1]), body.normalized_json);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!result) {
        sendJson(response, 404, {
          ok: false,
          error: "Match not found",
        });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "GET" &&
      pathParts[0] === "review-matches" &&
      pathParts.length === 2
    ) {
      const reviewMatch = getReviewMatch(db, decodeURIComponent(pathParts[1]));

      if (!reviewMatch) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match not found",
        });
        return;
      }

      sendJson(response, 200, {
        review_match: reviewMatch,
      });
      return;
    }

    if (
      request.method === "PATCH" &&
      pathParts[0] === "review-matches" &&
      pathParts.length === 2
    ) {
      let body;

      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!body || typeof body !== "object" || !body.normalized_json) {
        sendJson(response, 400, {
          ok: false,
          error: "normalized_json is required",
        });
        return;
      }

      let reviewMatch;

      try {
        reviewMatch = updateReviewMatchDraft(
          db,
          decodeURIComponent(pathParts[1]),
          body.normalized_json,
        );
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!reviewMatch) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match not found",
        });
        return;
      }

      sendJson(response, 200, {
        review_match: reviewMatch,
      });
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "review-matches" &&
      pathParts[2] === "approve" &&
      pathParts.length === 3
    ) {
      let result;
      let body;

      try {
        body = await readOptionalJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      try {
        result = approveReviewMatchWithOptions(db, decodeURIComponent(pathParts[1]), body);
      } catch (error) {
        if (error instanceof DedupeConflictError) {
          sendJson(response, 409, {
            ok: false,
            error: error.message,
            dedupe: error.dedupe,
          });
          return;
        }

        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!result) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match not found",
        });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "review-matches" &&
      pathParts[2] === "update-existing" &&
      pathParts.length === 3
    ) {
      let body;

      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!body || typeof body.match_id !== "string" || body.match_id.trim().length === 0) {
        sendJson(response, 400, {
          ok: false,
          error: "match_id is required",
        });
        return;
      }

      let result;

      try {
        result = updateImportedMatchFromReview(
          db,
          decodeURIComponent(pathParts[1]),
          body.match_id.trim(),
        );
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!result) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match not found",
        });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "review-matches" &&
      pathParts[2] === "reject" &&
      pathParts.length === 3
    ) {
      let result;

      try {
        result = rejectReviewMatch(db, decodeURIComponent(pathParts[1]));
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error.message,
        });
        return;
      }

      if (!result) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match not found",
        });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "GET" &&
      pathParts[0] === "review-matches" &&
      pathParts[2] === "screenshots" &&
      pathParts.length === 4
    ) {
      const localPath = getReviewMatchScreenshotPath(
        db,
        decodeURIComponent(pathParts[1]),
        pathParts[3],
      );

      if (!localPath) {
        sendJson(response, 404, {
          ok: false,
          error: "Review match screenshot not found",
        });
        return;
      }

      sendLocalFile(response, localPath);
      return;
    }

    if (
      request.method === "GET" &&
      pathParts[0] === "matches" &&
      pathParts[2] === "screenshots" &&
      pathParts.length === 4
    ) {
      const localPath = getImportedMatchScreenshotPath(
        db,
        decodeURIComponent(pathParts[1]),
        pathParts[3],
      );

      if (!localPath) {
        sendJson(response, 404, {
          ok: false,
          error: "Match screenshot not found",
        });
        return;
      }

      sendLocalFile(response, localPath);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: "Not found",
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message,
    });
  }
});

server.listen(port, host, () => {
  console.log(`HOK local API listening on http://${host}:${port}`);
});

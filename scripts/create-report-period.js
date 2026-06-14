import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import { createReportPeriodFromAllMatches } from "../server/reports/report-periods.js";

function readOption(name) {
  const prefix = `--${name}=`;
  const option = process.argv.find((arg) => arg.startsWith(prefix));

  return option ? option.slice(prefix.length) : null;
}

const db = await initializeDatabase();

try {
  seedFriends(db);

  const result = createReportPeriodFromAllMatches(db, {
    id: readOption("id") ?? undefined,
    name: readOption("name") ?? undefined,
    description: readOption("description") ?? undefined,
    replace: process.argv.includes("--replace"),
    sourceFilter: {
      created_by: "scripts/create-report-period.js",
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        created: result.created,
        period: result.period,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

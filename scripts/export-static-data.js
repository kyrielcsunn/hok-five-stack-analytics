import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import {
  buildStaticExport,
  getDefaultStaticExportPath,
  writeStaticExport,
} from "../server/reports/static-export.js";

function readOption(name) {
  const prefix = `--${name}=`;
  const option = process.argv.find((arg) => arg.startsWith(prefix));

  return option ? option.slice(prefix.length) : null;
}

const db = await initializeDatabase();

try {
  seedFriends(db);

  const outputPath = readOption("out") ?? getDefaultStaticExportPath();
  const payload = buildStaticExport(db, {
    periodId: readOption("period-id") ?? readOption("period_id") ?? undefined,
  });
  const writtenPath = await writeStaticExport(payload, outputPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: writtenPath,
        period_id: payload.period.id,
        match_count: payload.summary.match_count,
        friend_player_count: payload.summary.friend_player_count,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

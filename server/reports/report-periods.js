function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function toJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function normalizeId(value) {
  const id = String(value ?? "").trim();

  if (!id) {
    throw new Error("Report period id is required");
  }

  return id;
}

function normalizeMatchIds(matchIds) {
  if (!Array.isArray(matchIds)) {
    throw new Error("match_ids must be an array");
  }

  const normalized = Array.from(
    new Set(matchIds.map((matchId) => String(matchId ?? "").trim()).filter(Boolean)),
  );

  if (normalized.length === 0) {
    throw new Error("Report period must include at least one match");
  }

  return normalized;
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function toPeriod(row) {
  if (!row) {
    return null;
  }

  const matchIds = parseJsonField(row.match_ids_json, []);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    match_ids: matchIds,
    match_count: matchIds.length,
    source_filter: parseJsonField(row.source_filter_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listImportedMatchIds(db) {
  return db
    .prepare(
      `
        SELECT id
        FROM matches
        ORDER BY played_at ASC, id ASC
      `,
    )
    .all()
    .map((row) => row.id);
}

export function listReportPeriods(db) {
  return db
    .prepare(
      `
        SELECT id, name, description, match_ids_json, source_filter_json, created_at, updated_at
        FROM report_periods
        ORDER BY created_at DESC, id DESC
      `,
    )
    .all()
    .map(toPeriod);
}

export function getReportPeriod(db, id) {
  return toPeriod(
    db
      .prepare(
        `
          SELECT id, name, description, match_ids_json, source_filter_json, created_at, updated_at
          FROM report_periods
          WHERE id = ?
        `,
      )
      .get(id),
  );
}

export function getLatestReportPeriod(db) {
  return toPeriod(
    db
      .prepare(
        `
          SELECT id, name, description, match_ids_json, source_filter_json, created_at, updated_at
          FROM report_periods
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(),
  );
}

export function createReportPeriod(db, options) {
  const id = normalizeId(options.id);
  const name = String(options.name ?? "").trim();
  const description = options.description ? String(options.description).trim() : null;
  const matchIds = normalizeMatchIds(options.matchIds);
  const sourceFilter = options.sourceFilter ?? null;

  if (!name) {
    throw new Error("Report period name is required");
  }

  const existing = getReportPeriod(db, id);
  const existingMatchIdsJson = existing ? JSON.stringify(existing.match_ids) : null;
  const nextMatchIdsJson = JSON.stringify(matchIds);

  if (existing && !options.replace) {
    if (existingMatchIdsJson === nextMatchIdsJson) {
      return {
        created: false,
        period: existing,
      };
    }

    throw new Error(`Report period already exists with different match ids: ${id}`);
  }

  const foundRows = db
    .prepare(
      `
        SELECT id
        FROM matches
        WHERE id IN (${placeholders(matchIds)})
      `,
    )
    .all(...matchIds);
  const foundIds = new Set(foundRows.map((row) => row.id));
  const missingIds = matchIds.filter((matchId) => !foundIds.has(matchId));

  if (missingIds.length > 0) {
    throw new Error(`Report period contains unknown match ids: ${missingIds.join(", ")}`);
  }

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `
        UPDATE report_periods
        SET
          name = ?,
          description = ?,
          match_ids_json = ?,
          source_filter_json = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(name, description, nextMatchIdsJson, toJson(sourceFilter), now, id);

    return {
      created: false,
      period: getReportPeriod(db, id),
    };
  }

  db.prepare(
    `
      INSERT INTO report_periods (
        id,
        name,
        description,
        match_ids_json,
        source_filter_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(id, name, description, nextMatchIdsJson, toJson(sourceFilter), now, now);

  return {
    created: true,
    period: getReportPeriod(db, id),
  };
}

export function createReportPeriodFromAllMatches(db, options = {}) {
  const matchIds = listImportedMatchIds(db);

  return createReportPeriod(db, {
    id: options.id ?? "period:batch-001:first-30",
    name: options.name ?? `首批 ${matchIds.length} 局战报`,
    description:
      options.description ?? "batch-001 已入库正式对局，排除 012 指挥官模式和 032 重复局。",
    matchIds,
    replace: Boolean(options.replace),
    sourceFilter: {
      type: "all_imported_matches",
      match_count: matchIds.length,
      order: "played_at ASC, id ASC",
      ...options.sourceFilter,
    },
  });
}

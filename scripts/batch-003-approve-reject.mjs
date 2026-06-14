import { DatabaseSync } from 'node:sqlite';
import { approveReviewMatch, rejectReviewMatch } from '../server/review/review-actions.js';

const dbPath = process.env.HOK_DB_PATH || 'data/hok.sqlite';
const db = new DatabaseSync(dbPath);

const approveIds = [
  '001','002','003','004','005','006','007','008',
  '010','011','012','013','014','015','016',
].map((n) => `batch-003:${n}`);
const rejectIds = ['009','017','018'].map((n) => `batch-003:${n}`);

const results = { approved: [], rejected: [], errors: [] };

for (const id of approveIds) {
  try {
    const out = approveReviewMatch(db, id);
    results.approved.push({ id, match_id: out?.match?.id ?? null });
  } catch (err) {
    results.errors.push({ id, action: 'approve', message: err.message });
  }
}

for (const id of rejectIds) {
  try {
    const out = rejectReviewMatch(db, id);
    results.rejected.push({ id, status: out?.review_match?.status ?? null });
  } catch (err) {
    results.errors.push({ id, action: 'reject', message: err.message });
  }
}

db.close();
console.log(JSON.stringify(results, null, 2));

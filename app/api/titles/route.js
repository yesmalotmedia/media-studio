// Rows from the titles CSV not yet marked ערוך (edited) and not already
// claimed by another segment — see lib/titles.js for the full design.
import { listUnmatchedRows } from '../../../lib/titles.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ candidates: await listUnmatchedRows() });
}

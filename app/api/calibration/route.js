import { getBias, readStore } from '../../../lib/store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Exposes what the detector has "learned" from approved segments so far —
// kept visible rather than a silent black box (see lib/store.js recordCorrection).
export async function GET() {
  const total = readStore().calibration.length;
  const bias = getBias();
  return Response.json({ total, ...bias });
}

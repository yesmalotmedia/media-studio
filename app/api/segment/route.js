import { loadConfig, saveConfig } from '../../../lib/config.js';
import { updateSegment, getScan, recordCorrection, getBias } from '../../../lib/store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { folder: bodyFolder, id, patch } = await req.json();
  const folder = bodyFolder || loadConfig().source_folder;
  if (!id || !patch) return Response.json({ error: 'id and patch required' }, { status: 400 });

  // capture the pre-update record so we can learn from the human's edit
  // before it's overwritten by the patch below.
  const scan = getScan(folder);
  const before = scan?.segments.find((x) => x.id === id);

  const seg = updateSegment(folder, id, patch);
  if (!seg) return Response.json({ error: 'segment not found' }, { status: 404 });

  // approving with a start/end is a ground-truth correction: record it
  // (see lib/store.js recordCorrection/getBias) — but do NOT auto-apply a
  // global bias shift from just a couple of corrections. Confirmed on real
  // data (2026-09-03): a bias learned from ONE correction on one file got
  // applied to every future scan on every OTHER file/room, and actively cut
  // real content / mis-split an unrelated lesson. A flat global offset only
  // makes sense once there's enough evidence it's a genuinely systematic
  // bias, not a one-off — so it only kicks in past MIN_CORRECTIONS_TO_APPLY.
  const MIN_CORRECTIONS_TO_APPLY = 15;
  if (patch.status === 'approved' && patch.start != null && patch.end != null && before) {
    recordCorrection({
      source: before.source,
      detectedStart: before.detectedStart,
      detectedEnd: before.detectedEnd,
      approvedStart: patch.start,
      approvedEnd: patch.end,
    });
    const bias = getBias();
    if (bias.n >= MIN_CORRECTIONS_TO_APPLY) {
      saveConfig({ detect: { ...loadConfig().detect, startBiasSec: bias.startBiasSec, endBiasSec: bias.endBiasSec } });
    }
  }

  return Response.json({ ok: true, segment: seg });
}

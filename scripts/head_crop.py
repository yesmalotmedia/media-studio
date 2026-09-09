"""
Compute a fixed 16:9 crop rectangle for one lesson (segment), based on where
the speaker's head reaches throughout it — see CLAUDE.md "זום אוטומטי".

Approach: sample frames across [start,end) of the source file, detect the
face with OpenCV's YuNet (ONNX, runs via cv2.dnn — NOT the onnxruntime pip
package, which was flagged as fragile to install on this Windows setup).
Estimate "top of head" per frame as a bit above the detected face box (the
detector's box starts around the eyebrows, not the hairline/skull), take a
robust low percentile across all samples (not the literal min — one bad
detection shouldn't skew the whole lesson's crop), then position the crop
so that point sits `head_margin` from the top of the crop, `crop_h_frac` of
the source height tall, 16:9, horizontally centered.

Calibrated on a real shiur (2026-09-02, see data/crop_preview/) with a human
reviewing actual rendered crops — see config.json -> crop for the numbers.

Usage: python head_crop.py <video_path> <start_sec> <end_sec> [--step S]
Prints ONE line of JSON to stdout (last line of stdout is authoritative —
OpenCV may print warnings to stdout on some builds, so callers should parse
the last non-empty line, not the whole stream).
"""
import cv2
import sys
import os
import json
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "..", "models", "yunet.onnx")


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(p * len(sorted_vals)))
    return sorted_vals[idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--step", type=float, default=3.0)
    ap.add_argument("--conf", type=float, default=0.6)
    ap.add_argument("--anchor-pct", type=float, default=0.05, help="percentile of head-top to anchor on (robust to outliers)")
    ap.add_argument("--head-margin", type=float, default=0.03)
    ap.add_argument("--crop-h-frac", type=float, default=0.85)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(json.dumps({"ok": False, "reason": "cannot open video"}))
        return
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if W <= 0 or H <= 0:
        print(json.dumps({"ok": False, "reason": "bad video dimensions"}))
        return

    detector = cv2.FaceDetectorYN.create(MODEL, "", (W, H), score_threshold=args.conf)

    head_top_fracs = []
    head_x_fracs = []  # horizontal center of the detected head, as a fraction of frame width
    n_sampled = 0
    n_detected = 0
    t = args.start
    while t < args.end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if ok:
            n_sampled += 1
            _, faces = detector.detect(frame)
            best = None
            if faces is not None:
                for f in faces:
                    if best is None or f[-1] > best[-1]:
                        best = f
            if best is not None:
                n_detected += 1
                x, y, w, h = best[0:4]
                head_top = max(0, y - 0.35 * h)
                head_top_fracs.append(head_top / H)
                head_x_fracs.append((x + w / 2) / W)
        t += args.step

    if n_detected < max(3, 0.2 * n_sampled):
        # too few detections to trust — different framing, no one on camera
        # for most of it, bad lighting, etc. Caller should skip cropping.
        print(json.dumps({"ok": False, "reason": "insufficient face detections",
                           "sampled": n_sampled, "detected": n_detected}))
        return

    head_top_fracs.sort()
    anchor = percentile(head_top_fracs, args.anchor_pct)

    # HISTORY (2026-09-08): horizontal placement used to just be the source
    # frame's own midpoint — CONFIRMED FOR REAL this is wrong whenever the
    # camera itself isn't perfectly centered on the seat (common — cameras
    # get bumped/repositioned, or were never dead-center to begin with), so
    # the rabbi ends up off-center in the delivered 16:9 crop even though the
    # vertical framing is correct. Fixed the same way the vertical anchor
    # already works: use the ACTUAL detected head position, not an assumption
    # about the source frame. Unlike the vertical anchor (a deliberately
    # extreme low percentile, to catch the highest the head ever gets),
    # horizontal wants the TYPICAL position across the lesson — median — so
    # an occasional lean/gesture to one side doesn't drag the whole crop off
    # center; sorted list, so this is just the middle element.
    head_x_fracs.sort()
    x_anchor = float(percentile(head_x_fracs, 0.5))  # numpy float32 from cv2 isn't JSON-serializable with round()'s 2-arg form

    crop_h = args.crop_h_frac * H
    crop_w = crop_h * 16 / 9
    crop_top = max(0, anchor * H - args.head_margin * crop_h)
    crop_left = max(0, x_anchor * W - crop_w / 2)
    # clamp to source bounds (shouldn't normally trigger given crop_h_frac<1)
    if crop_top + crop_h > H:
        crop_top = H - crop_h
    if crop_left + crop_w > W:
        crop_left = W - crop_w

    print(json.dumps({
        "ok": True,
        "sourceW": W, "sourceH": H,
        "sampled": n_sampled, "detected": n_detected,
        "x": round(crop_left), "y": round(crop_top),
        "w": round(crop_w), "h": round(crop_h),
        "headXFrac": round(x_anchor, 4),  # for diagnostics: 0.5 would mean "happened to be frame-centered anyway"
    }))


if __name__ == "__main__":
    main()

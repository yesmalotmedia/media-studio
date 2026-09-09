"""
Run one audio file through Supertone Clear (VST3) to reduce room echo/reverb,
matching parameters calibrated by hand in DaVinci Resolve's Fairlight page on
a real shiur (2026-09-03) — see data/clear_test/ for the before/after samples
that were approved. Runs the plugin directly via `pedalboard` (Spotify's VST3
host library) — no DaVinci Resolve process needed at export time.

Usage: python dereverb.py <in_wav> <out_wav> [--ambience-gain N] [--voice-gain N] [--voice-reverb-gain N] [--program NAME]
"""
import sys
import argparse
from pedalboard import load_plugin
from pedalboard.io import AudioFile

PLUGIN_PATH = r"C:\Program Files\Common Files\VST3\Clear.vst3"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("in_wav")
    ap.add_argument("out_wav")
    ap.add_argument("--ambience-gain", type=float, default=-29.1)
    ap.add_argument("--voice-gain", type=float, default=0.0)
    ap.add_argument("--voice-reverb-gain", type=float, default=-60.0)
    ap.add_argument("--program", default=None, help="one of: 0. Default / 1. Studio / 2. Concert Hall / 3. OutDoor / 4. Ghost / 5. Silence")
    args = ap.parse_args()

    plugin = load_plugin(PLUGIN_PATH)
    if args.program:
        plugin.program = args.program
    plugin.ambience_gain = args.ambience_gain
    plugin.voice_gain = args.voice_gain
    plugin.voice_reverb_gain = args.voice_reverb_gain

    with AudioFile(args.in_wav) as f:
        audio = f.read(f.frames)
        sr = f.samplerate

    out = plugin(audio, sr)

    with AudioFile(args.out_wav, "w", sr, out.shape[0]) as f:
        f.write(out)

    print("ok")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

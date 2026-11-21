#!/usr/bin/env python3
"""Prepares the songs in music/ for Vocal Quest. For every "Artist - Title.mp3" it creates:

  Artist - Title.vocals.wav   isolated vocals                       (Mel-Band RoFormer)
  Artist - Title.notes.json   the melody that is actually sung      (pYIN pitch tracking + cleanup)
  Artist - Title.lrc          lyrics with word-by-word timing       (forced alignment to the vocals)

Anything that already exists is skipped, so you can run it again after adding songs.

    python tools/prepare.py                  # everything in music/
    python tools/prepare.py --only "katy"    # only songs whose name contains "katy"
    python tools/prepare.py --no-lyrics      # skip the lyric timing step
    python tools/prepare.py --force          # redo everything
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

AUDIO = {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"}
STAMP = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
WORDTAG = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
DEFAULT_MODEL = "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"


# ---------------------------------------------------------------- stems
_SEP = None


def get_separator(args, output_dir: Path):
    global _SEP
    if _SEP is None:
        from audio_separator.separator import Separator

        Path(args.models_dir).mkdir(parents=True, exist_ok=True)
        _SEP = Separator(
            model_file_dir=str(args.models_dir),
            output_dir=str(output_dir),
            output_format="MP3" if args.mp3 else "WAV",
            output_single_stem="Vocals",
        )
        _SEP.load_model(model_filename=args.model)
    _SEP.output_dir = str(output_dir)
    return _SEP


def find_stem(f: Path):
    return next((p for e in AUDIO if (p := f.parent / f"{f.stem}.vocals{e}").exists()), None)


def separate(f: Path, args):
    ext = ".mp3" if args.mp3 else ".wav"
    target = f.parent / f"{f.stem}.vocals{ext}"
    sep = get_separator(args, f.parent)
    out_files = sep.separate(str(f))
    if not out_files:
        return None
    out = Path(out_files[0])
    if not out.is_absolute():
        out = f.parent / out
    if not out.exists():
        return None
    shutil.move(str(out), str(target))
    return target


# ---------------------------------------------------------------- melody
def clean_pitch(m, hs):
    """m: MIDI pitch per frame (nan = unvoiced). Fixes octave errors, drops blips, smooths, bridges tiny gaps."""
    import numpy as np

    n, W = len(m), max(2, int(0.75 / hs))
    o = m.copy()
    shift = np.zeros(n)
    for i in range(n):
        if np.isnan(m[i]):
            continue
        w = np.concatenate([m[max(0, i - W):i], m[i + 1:i + 1 + W]])
        w = w[~np.isnan(w)]
        if len(w) < 3:
            o[i] = np.nan
            continue
        d = m[i] - np.median(w)
        k = int(np.round(d / 12))
        if k and abs(d - 12 * k) <= 1.5:  # looks like an octave error, not a real leap
            shift[i] = k
    # only correct short runs; a real octave leap lasts longer than a pYIN glitch
    maxrun, i = int(0.2 / hs), 0
    while i < n:
        if shift[i]:
            j = i
            while j < n and shift[j] == shift[i]:
                j += 1
            if j - i <= maxrun:
                o[i:j] = m[i:j] - 12 * shift[i]
            i = j
        else:
            i += 1

    s = o.copy()
    for i in range(n):
        if not np.isnan(o[i]):
            w = o[max(0, i - 2):i + 3]
            w = w[~np.isnan(w)]
            if len(w) >= 3:
                s[i] = np.median(w)
    gap, i = max(1, int(0.12 / hs)), 1
    while i < n - 1:
        if np.isnan(s[i]):
            j = i
            while j < n and np.isnan(s[j]):
                j += 1
            if j - i <= gap and j < n and not np.isnan(s[i - 1]) and abs(s[i - 1] - s[j]) <= 1:
                s[i:j] = np.linspace(s[i - 1], s[j], j - i + 2)[1:-1]
            i = j
        i += 1
    return s


def notes_from_pitch(m, times):
    """Splits a cleaned pitch curve into notes. A new note starts after a sustained change, so vibrato stays one note."""
    import numpy as np

    hs = float(times[1] - times[0])
    hold, minlen = max(2, int(0.09 / hs)), max(2, int(0.15 / hs))
    notes, cur, dev, gap = [], None, [], 0

    def close():
        nonlocal cur, dev, gap
        if cur and len(cur["v"]) >= minlen:
            notes.append([float(times[cur["i"]]), float(times[cur["last"]]) + hs, int(round(float(np.median(cur["v"]))))])
        cur, dev, gap = None, [], 0

    def absorb_short(notes, min_len=0.18, max_gap=0.15):
        while True:
            for i, n in enumerate(notes):
                if n["e"] - n["s"] >= min_len:
                    continue
                nb = [k for k in (i - 1, i + 1) if 0 <= k < len(notes)
                      and abs(n["m"] - notes[k]["m"]) <= 2
                      and (n["s"] - notes[k]["e"] if k < i else notes[k]["s"] - n["e"]) <= max_gap]
                if nb:
                    j = max(nb, key=lambda k: notes[k]["e"] - notes[k]["s"])
                    notes[j]["s"] = min(notes[j]["s"], n["s"])
                    notes[j]["e"] = max(notes[j]["e"], n["e"])
                    del notes[i]
                    break
                else:
                    return notes

    for i, v in enumerate(m):
        if np.isnan(v):
            if cur:
                gap += 1
                if gap * hs > 0.1:
                    close()
            continue
        gap = 0
        if not cur:
            cur = {"i": i, "last": i, "v": [v]}
        elif abs(v - np.median(cur["v"])) >= 0.8:
            dev.append(i)
            if len(dev) >= hold:
                st, vs = dev[0], [m[k] for k in dev]
                cur["last"] = st - 1
                close()
                cur = {"i": st, "last": i, "v": vs}
                dev = []
        else:
            cur["v"].append(v)
            cur["last"] = i
            dev = []
    close()
    out = []
    for s, e, p in notes:
        if out and out[-1][2] == p and s - out[-1][1] <= 0.12:
            out[-1][1] = e
        else:
            out.append([s, e, p])

    out = absorb_short([{"s": s, "e": e, "m": p} for s, e, p in out])
    return [{"s": round(n["s"], 3), "e": round(n["e"], 3), "m": n["m"]} for n in out]

def fix_outliers(notes, window=4.0, jump=7, octave_tol=1.5):
    """Compares each note with its neighbours (+-window seconds). Short notes that sit far away are
    folded by an octave if they look like an octave error, otherwise dropped."""
    import numpy as np

    out, folded, dropped = [], 0, 0
    for n in notes:
        mid, dur = (n["s"] + n["e"]) / 2, n["e"] - n["s"]
        nb = [k["m"] for k in notes if k is not n and abs((k["s"] + k["e"]) / 2 - mid) <= window]
        if len(nb) < 3:
            out.append(n)
            continue
        d = n["m"] - float(np.median(nb))
        if abs(d) < jump:
            out.append(n)
            continue
        k = int(round(d / 12))
        if k and abs(d - 12 * k) <= octave_tol and dur < 0.5:
            out.append({**n, "m": n["m"] - 12 * k})
            folded += 1
        elif dur < 0.6:
            dropped += 1
        else:
            out.append(n)  # long note far from its neighbours: probably a real leap, keep it
    print(f"  outliers: {folded} folded, {dropped} dropped")
    return out

def track_melody(stem: Path):
    import librosa
    import numpy as np

    sr, hop = 22050, 256
    y, _ = librosa.load(str(stem), sr=sr, mono=True)
    f0, voiced, prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("F2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sr,
        frame_length=2048,
        hop_length=hop,
        fill_na=None,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    m = np.full(len(f0), np.nan)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0][:len(f0)]
    loud = rms > 0.04 * np.percentile(rms, 95)
    ok = np.isfinite(f0) & loud & voiced
    m[ok] = librosa.hz_to_midi(f0[ok])
    return fix_outliers(notes_from_pitch(clean_pitch(m, hop / sr), times))


# ---------------------------------------------------------------- lyrics
def stamp_fmt(t):
    return f"{int(t // 60):02d}:{t % 60:05.2f}"


def parse_lines(text):
    out = []
    for l in text.splitlines():
        body = re.sub(r"\[[^\]]*\]|<[^>]*>", "", l)
        txt = re.sub(r"\s+", " ", body).strip()
        for m in STAMP.finditer(l):
            if txt:
                out.append((int(m.group(1)) * 60 + float(m.group(2)), txt))
    return sorted(out)


def build_line(words, end):
    """words: [(start, text)] -> enhanced LRC line."""
    return f"[{stamp_fmt(words[0][0])}]" + "".join(f"<{stamp_fmt(t)}>{w} " for t, w in words) + f"<{stamp_fmt(end)}>"


def fetch_lrc(name):
    m = re.split(r"\s[-–]\s", name, maxsplit=1)
    q = {"track_name": m[1] if len(m) > 1 else m[0]}
    if len(m) > 1:
        q["artist_name"] = m[0]
    try:
        req = urllib.request.Request(
            "https://lrclib.net/api/search?" + urllib.parse.urlencode(q),
            headers={"User-Agent": "vocal-quest-prepare"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return next((x["syncedLyrics"] for x in json.load(r) if x.get("syncedLyrics")), None)
    except Exception as e:
        print(f"  lyrics lookup failed: {e}")
        return None


_FA = {}


def align_lyrics(stem: Path, text: str, device: str):
    """Forced alignment of each lyric line against the vocal stem (torchaudio MMS_FA). Returns enhanced LRC text."""
    import librosa
    import torch
    import torchaudio
    import numpy as np

    if not _FA:
        bundle = torchaudio.pipelines.MMS_FA
        _FA.update(
            bundle=bundle,
            dict=bundle.get_dict(star=None),
            model=bundle.get_model(with_star=False).to(device).eval(),
        )
    bundle, dic, model = _FA["bundle"], _FA["dict"], _FA["model"]
    sr = bundle.sample_rate
    y, _ = librosa.load(str(stem), sr=sr, mono=True)
    dur = len(y) / sr
    lines = parse_lines(text)
    result = []

    fhop = 0.02
    rms = librosa.feature.rms(y=y, frame_length=int(2 * fhop * sr), hop_length=int(fhop * sr))[0]
    ref = np.percentile(rms, 95)

    def extend_end(end, limit):
        i, lim = int(end / fhop), min(len(rms) - 1, int(limit / fhop))
        while i < lim and rms[i] > 0.15 * ref:
            i += 1
        return i * fhop

    for i, (t, txt) in enumerate(lines):
        nxt = lines[i + 1][0] if i + 1 < len(lines) else t + 12
        a, b = max(0.0, t - 1.0), min(dur, nxt + 0.3)
        items = []  # (raw word, normalised letters)
        for w in txt.split():
            n = "".join(c for c in unicodedata.normalize("NFKD", w.lower().replace("’", "'")) if c in dic and c != "-")
            if n or not items:
                items.append([w, n])
            else:
                items[-1][0] += " " + w
        try:
            items = [it for it in items if it[1]]
            seg = torch.from_numpy(y[int(a * sr):int(b * sr)]).float()[None].to(device)
            with torch.inference_mode():
                emission, _ = model(seg)
            lp = torch.log_softmax(emission, -1)
            ids = [dic[c] for _, n in items for c in n]
            targets = torch.tensor([ids], dtype=torch.int32, device=device)
            aligned, scores = torchaudio.functional.forced_align(lp, targets, blank=0)
            spans = torchaudio.functional.merge_tokens(aligned[0], scores[0].exp())
            ratio = seg.size(1) / lp.size(1) / sr
            words, k = [], 0
            for raw, n in items:
                sp = spans[k:k + len(n)]
                k += len(n)
                words.append((a + sp[0].start * ratio, raw, a + sp[-1].end * ratio))
            if len(spans) != len(ids):
                raise RuntimeError("alignment length mismatch")
            end = extend_end(words[-1][2], nxt - 0.05)
            result.append(build_line([(s, w) for s, w, _ in words], end))
        except Exception as e:
            print(f"  line {i + 1} could not be aligned ({e}); keeping line timing")
            result.append(f"[{stamp_fmt(t)}]{txt}")
    return "\n".join(result) + "\n"


def active_vocal_spans(lrc_text: str, pad: float = 0.25):
    """Extracts (start, end) intervals where lyrics are actually sung."""
    spans = []
    lines = lrc_text.splitlines()
    for i, line in enumerate(lines):
        word_stamps = [int(m.group(1)) * 60 + float(m.group(2)) for m in WORDTAG.finditer(line)]
        if len(word_stamps) >= 2:
            spans.append((max(0.0, word_stamps[0] - pad), word_stamps[-1] + pad))
        else:
            m = STAMP.search(line)
            if m and re.sub(r"\[[^\]]*\]", "", line).strip():
                t0 = int(m.group(1)) * 60 + float(m.group(2))
                t1 = t0 + 10.0
                for nxt in lines[i + 1:]:
                    nm = STAMP.search(nxt)
                    if nm:
                        t1 = int(nm.group(1)) * 60 + float(nm.group(2))
                        break
                spans.append((max(0.0, t0 - pad), t1 + pad))
    return spans

# ---------------------------------------------------------------- main
def songs(music: Path, only: str):
    for f in sorted(music.iterdir()):
        if f.suffix.lower() in AUDIO and not f.stem.lower().endswith(".vocals") and (not only or only.lower() in f.stem.lower()):
            yield f


def process(f: Path, args, device):
    notes_p, lrc_p = f.parent / f"{f.stem}.notes.json", f.parent / f"{f.stem}.lrc"
    old = lrc_p.read_text(encoding="utf-8", errors="ignore") if lrc_p.exists() else None
    need_lyrics = not args.no_lyrics and (args.force or old is None or not WORDTAG.search(old))
    need_melody = not args.no_melody and (args.force or not notes_p.exists())
    stem = find_stem(f)
    if stem and args.force and not (args.no_melody and args.no_lyrics):
        stem = None
    if not stem and (need_melody or need_lyrics or args.force):
        print("  separating vocals with Mel-Band RoFormer (this is the slow part)...", flush=True)
        stem = separate(f, args)
        if not stem:
            return False

    enhanced_lrc = old
    if need_lyrics and stem:
        text = old or fetch_lrc(f.stem)
        if not text:
            print("  no lyrics found; skipping lyric timing")
        else:
            print("  aligning lyrics to the vocals...", flush=True)
            try:
                enhanced_lrc = align_lyrics(stem, text, device)
                if old is not None:
                    shutil.copy(lrc_p, f.parent / f"{f.stem}.lrc.orig")
                lrc_p.write_text(enhanced_lrc, encoding="utf-8")
                print("  word-timed lyrics written")
            except Exception as e:
                print(f"  lyric alignment failed ({e}); writing plain lyrics instead")
                enhanced_lrc = text
                if old is None:
                    lrc_p.write_text(text, encoding="utf-8")

    if need_melody and stem:
        print("  tracking melody...", flush=True)
        notes = track_melody(stem)
        notes_p.write_text(json.dumps({"notes": notes}), encoding="utf-8")
        print(f"  {len(notes)} notes written")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Prepare songs for Vocal Quest")
    ap.add_argument("--music-dir", type=Path, default=Path(__file__).resolve().parent.parent / "music")
    ap.add_argument("--models-dir", type=Path, default=Path(os.environ.get("TORCH_HOME", "/models")))
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--device", default="", help="cpu or cuda for lyric alignment (default: automatic)")
    ap.add_argument("--mp3", action="store_true", help="write the vocal stem as mp3")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true", help="redo everything, even if files exist")
    ap.add_argument("--no-melody", action="store_true")
    ap.add_argument("--no-lyrics", action="store_true")
    args = ap.parse_args()
    if importlib.util.find_spec("audio_separator") is None:
        print("audio-separator is not installed. Run:  pip install -r tools/requirements.txt  (and install ffmpeg)\n"
              "or rebuild Docker:  docker compose build prepare")
        return 1
    if not args.music_dir.is_dir():
        print(f"Music folder not found: {args.music_dir}")
        return 1
    import torch

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    todo = list(songs(args.music_dir, args.only))
    failed = []
    for n, f in enumerate(todo, 1):
        print(f"\n[{n}/{len(todo)}] {f.name}", flush=True)
        try:
            ok = process(f, args, device)
        except Exception as e:
            print(f"  ERROR: {e}")
            ok = False
        if not ok:
            failed.append(f.name)
    print(f"\nDone. {len(todo) - len(failed)} song(s) prepared, {len(failed)} failed.")
    for name in failed:
        print("  -", name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
"""
Score Strudel voice renders of the voice corpus (scripts/speech/voice-corpus.ts): word error rate
per category, target-word accuracy for carrier items, and an audible-discontinuity count.
Development tool only.

    # wavs in <dir>/<voice>/<id>.wav (the layout asr_whisper.py reads)
    python3 scripts/speech/asr_whisper.py <dir> <modelDir> ...    # writes <dir>/asr*.json
    python3 scripts/speech/voice-eval.py <items.json> <dir> [<items.json> <dir> ...]

Discontinuities: clicks show up as broadband bursts that stand out from their neighbourhood. The
energy above 5 kHz in 1 ms frames is compared with its 21 ms running median; a frame more than
18 dB above it that has fallen back within 3 ms counts as one click.
"""
import glob, json, os, re, sys, wave
import numpy as np

norm = lambda s: re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("'d", "d")).split()


def ed(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        p, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] != b[j - 1]))
    return d[-1]


def clicks(path):
    w = wave.open(path)
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float64) / 32768
    # crude high-pass: first difference twice (+12 dB/oct), then 1 ms frame energy
    h = np.diff(np.diff(x))
    n = sr // 1000
    e = np.array([np.sum(h[i : i + n] ** 2) for i in range(0, len(h) - n, n)]) + 1e-12
    db = 10 * np.log10(e)
    k = 10
    med = np.array([np.median(db[max(0, i - k) : i + k + 1]) for i in range(len(db))])
    # a click is brief: it stands out from its neighbourhood and is gone again 3 ms later
    # (onsets of noise or voicing stay up and are not counted)
    after = np.array([np.mean(db[i + 3 : i + 8]) if i + 8 <= len(db) else db[i] for i in range(len(db))])
    hits = (db - med > 18) & (db > db.max() - 50) & (after - med < 8)
    # one click per run of hits
    return int(np.sum(hits[1:] & ~hits[:-1]) + (hits[0] if len(hits) else 0)), len(x) / sr


def score(items_file, wav_dir):
    items = {i["id"]: i for i in json.load(open(items_file))}
    out = {}
    for f in sorted(glob.glob(os.path.join(wav_dir, "asr*.json"))):
        name = os.path.basename(f)[4:-5] or "base"
        name = name.lstrip(".") or "base"
        asr = json.load(open(f))
        cat = {}
        for k, hyp in asr.items():
            i = items.get(os.path.basename(k)[:-4])
            if not i:
                continue
            r, h = norm(i["text"]), norm(hyp)[: len(norm(i["text"])) + 3]
            c = cat.setdefault(i["category"], [0, 0, 0, 0])
            c[0] += ed(r, h)
            c[1] += len(r)
            if i.get("target") or i["text"].startswith("Say "):
                t = norm(i["text"])[1:-1]
                c[2] += all(w in h for w in t)
                c[3] += 1
        out[name] = cat
    cl, secs = 0, 0
    for i in items:
        p = (glob.glob(os.path.join(wav_dir, "*", f"{i}.wav")) or [""])[0]
        if p:
            c, s = clicks(p)
            cl += c
            secs += s
    return out, cl / max(secs, 1e-9)


if __name__ == "__main__":
    a = sys.argv[1:]
    for items_file, wav_dir in zip(a[::2], a[1::2]):
        res, cps = score(items_file, wav_dir)
        print(f"## {wav_dir}  clicks/s {cps:.2f}")
        cats = sorted({c for r in res.values() for c in r})
        print("| recogniser | " + " | ".join(cats) + " | all | targets |")
        for name, r in res.items():
            tot = [sum(r[c][j] for c in r) for j in range(4)]
            cells = [f"{100 * r[c][0] / max(1, r[c][1]):.0f}" for c in cats]
            print(f"| {name} | " + " | ".join(cells) + f" | {100 * tot[0] / max(1, tot[1]):.1f} | {tot[2]}/{tot[3]} |")

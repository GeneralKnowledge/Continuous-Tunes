"""
Compare synthetic speech with natural recordings of the same sentences (held-out CMU ARCTIC
prompts, never used for units or pulses), for any set of engines.

    python3 scripts/speech/natural-compare.py <naturalWavDir> label=dir [label=dir …] [--ids-from arctic_b0490]

Per utterance, after trimming leading/trailing silence:
- MCD (dB): mel-cepstral distortion on DTW-aligned frames, cepstra c1–c24 from a 40-band mel
  spectrum (MFCC-style; absolute values are not comparable with SPTK mel-cepstrum MCDs, rankings are);
- F0: Praat pitch; RMSE (cents, after removing each signal's mean log-f0 — the voices differ in
  register) and correlation over frames voiced in both, along the DTW path;
- V/UV agreement: share of DTW-aligned frames where both agree on voicing;
- duration ratio: synthetic / natural speech length.
Lower MCD and F0 RMSE, higher correlation and agreement, ratio near 1 = closer to the natural
speaker. The natural speaker is Scottish (awb) and our plans are SSB, so no engine can reach 0;
the comparison ranks engines and shows which aspects (spectrum, pitch, timing) are furthest away.
"""
import glob, json, os, sys
import numpy as np
import librosa
import parselmouth

SR = 16000
HOP = 0.005


def load(path):
    y, _ = librosa.load(path, sr=SR)
    y, _ = librosa.effects.trim(y, top_db=35)
    return y


def ceps(y):
    m = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=25, n_fft=512, hop_length=int(HOP * SR), win_length=400, n_mels=40)
    # librosa cepstra are DCTs of dB spectra; rescale to natural-log cepstra so the usual MCD constant applies
    return m[1:] * np.log(10) / 10


def f0(y):
    p = parselmouth.Sound(y, SR).to_pitch(time_step=HOP, pitch_floor=60, pitch_ceiling=350)
    return p.selected_array['frequency']


def compare(nat, syn):
    a, b = ceps(nat), ceps(syn)
    D, wp = librosa.sequence.dtw(X=a, Y=b, metric='euclidean')
    wp = wp[::-1]
    diff = a[:, wp[:, 0]] - b[:, wp[:, 1]]
    mcd = float(np.mean((10 / np.log(10)) * np.sqrt(2 * np.sum(diff ** 2, axis=0))))
    fa, fb = f0(nat), f0(syn)
    ia = np.minimum(wp[:, 0], len(fa) - 1)
    ib = np.minimum(wp[:, 1], len(fb) - 1)
    va, vb = fa[ia] > 0, fb[ib] > 0
    both = va & vb
    res = {'mcd': mcd, 'vuv': float(np.mean(va == vb)), 'ratio': len(syn) / len(nat)}
    if both.sum() > 10:
        ca = 1200 * np.log2(fa[ia][both]); cb = 1200 * np.log2(fb[ib][both])
        ca -= ca.mean(); cb -= cb.mean()
        res['f0rmse'] = float(np.sqrt(np.mean((ca - cb) ** 2)))
        res['f0corr'] = float(np.corrcoef(ca, cb)[0, 1])
    return res


def main():
    args = sys.argv[1:]
    ids_from = 'arctic_b0490'
    if '--ids-from' in args:
        i = args.index('--ids-from'); ids_from = args[i + 1]; del args[i:i + 2]
    nat_dir, engines = args[0], [a.split('=', 1) for a in args[1:]]
    ids = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(nat_dir, 'arctic_*.wav')) if os.path.basename(p)[:-4] >= ids_from)
    print(f'{len(ids)} held-out utterances from {ids[0]} to {ids[-1]}\n')
    print('| engine | MCD dB | F0 RMSE (cents) | F0 corr | V/UV agree | duration ratio |')
    print('|---|---|---|---|---|---|')
    summary = {}
    for label, d in engines:
        rows = []
        for uid in ids:
            p = os.path.join(d, uid + '.wav')
            if os.path.exists(p):
                rows.append(compare(load(os.path.join(nat_dir, uid + '.wav')), load(p)))
        m = lambda k: float(np.mean([r[k] for r in rows if k in r]))
        summary[label] = {k: m(k) for k in ('mcd', 'f0rmse', 'f0corr', 'vuv', 'ratio')} | {'n': len(rows)}
        s = summary[label]
        print(f"| {label} | {s['mcd']:.2f} | {s['f0rmse']:.0f} | {s['f0corr']:.2f} | {100 * s['vuv']:.0f}% | {s['ratio']:.2f} |")
    print('\n' + json.dumps(summary))


if __name__ == '__main__':
    main()

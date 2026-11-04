"""
Acoustic measurements of obstruents, for comparing the Strudel voice with recorded speech.

    python3 scripts/speech/consonant-measure.py natural <wavDir> <alignDir> [--ids a-b] > nat.json
    python3 scripts/speech/consonant-measure.py synth <renderDir> [--ids a-b] > syn.json
    python3 scripts/speech/consonant-measure.py compare nat.json syn.json [more.json ...]

`natural` reads aligned recordings (corpus/align.py output); `synth` reads render-offline.ts
output (wavs plus the plans' segment times). Both are analysed at 16 kHz with the same code:

Fricatives (f v θ ð s z ʃ ʒ): duration; voiced fraction (Praat autocorrelation pitch, 5 ms);
harmonicity (Praat cc HNR, dB); low-frequency share (50–400 Hz energy over 50–8000 Hz, dB);
spectral centroid above 1 kHz; level relative to the loudest neighbouring vowel.
Stops (p b t d k g, before a vowel): closure voicing (voiced fraction of the first 70% of the
interval); release time (largest rise of 1–8 kHz energy, 1 ms hops, near the end of the
interval); burst level (10 ms after the release, relative to the vowel) and centroid; VOT (release
to the first voiced frame).

Alignment of the recordings is automatic (15–30 ms on boundaries), so read medians over many
tokens, not single values. Praat runs through praat-parselmouth (GPL), as analysis only.
"""
import glob, json, os, sys
import numpy as np
import librosa
import parselmouth

SR = 16000
FRIC = set('f v θ ð s z ʃ ʒ'.split())
STOPS = set('p b t d k g'.split())
VOWELS = set('iː ɪ e æ ʌ ɑː ɒ ɔː ʊ uː ɜː ə i eɪ aɪ ɔɪ əʊ aʊ ɪə eə ʊə'.split())


def db(x):
    return 10 * np.log10(max(x, 1e-12))


def analyse(wav, phones):
    """phones: list of (phone, start, end)"""
    y, _ = librosa.load(wav, sr=SR)
    snd = parselmouth.Sound(y.astype(np.float64), SR)
    pitch = snd.to_pitch_ac(time_step=0.0025, pitch_floor=60, pitch_ceiling=400)
    pt = pitch.xs()
    pv = pitch.selected_array['frequency'] > 0
    hnr = snd.to_harmonicity_cc(time_step=0.005, minimum_pitch=60)
    ht = hnr.xs()
    hv = hnr.values[0]

    def voiced_frac(a, b):
        m = (pt >= a) & (pt < b)
        return float(pv[m].mean()) if m.any() else None

    def first_voiced(a, b):
        m = np.where((pt >= a) & (pt < b) & pv)[0]
        return float(pt[m[0]]) if len(m) else None

    def hnr_mean(a, b):
        m = (ht >= a) & (ht < b)
        v = hv[m]
        v = v[v > -200]
        return float(np.mean(np.clip(v, -10, 40))) if len(v) else -10.0

    def seg(a, b):
        return y[max(0, int(a * SR)):max(int(a * SR) + 1, int(b * SR))]

    def spectrum(x):
        if len(x) < 32:
            x = np.pad(x, (0, 32 - len(x)))
        w = np.hanning(len(x))
        P = np.abs(np.fft.rfft(x * w, n=max(512, 1 << int(np.ceil(np.log2(len(x))))))) ** 2
        f = np.fft.rfftfreq(max(512, 1 << int(np.ceil(np.log2(len(x))))), 1 / SR)
        return f, P

    def rms_db(x):
        return db(np.mean(x ** 2)) if len(x) else -120.0

    def band_energy(x, lo, hi):
        f, P = spectrum(x)
        return P[(f >= lo) & (f < hi)].sum()

    def centroid(x, lo=1000):
        f, P = spectrum(x)
        m = f >= lo
        return float((f[m] * P[m]).sum() / max(P[m].sum(), 1e-12))

    # 1-8 kHz energy envelope at 1 ms hops
    hp = librosa.effects.preemphasis(y, coef=0.97)
    S = np.abs(librosa.stft(hp, n_fft=128, hop_length=16, win_length=64)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=128)
    env = 10 * np.log10(S[(fr >= 1000)].sum(axis=0) + 1e-10)
    et = np.arange(len(env)) * 16 / SR

    out = []
    for k, (ph, a, b) in enumerate(phones):
        prev = phones[k - 1][0] if k > 0 else '_'
        nxt = phones[k + 1][0] if k + 1 < len(phones) else '_'
        vowel_levels = [rms_db(seg(*phones[j][1:])) for j in (k - 1, k + 1) if 0 <= j < len(phones) and phones[j][0] in VOWELS]
        vref = max(vowel_levels) if vowel_levels else None
        d = b - a
        if ph in FRIC and d > 0.03:
            m0, m1 = a + 0.2 * d, b - 0.2 * d
            x = seg(m0, m1)
            tot = band_energy(x, 50, 8000)
            out.append({'phone': ph, 'kind': 'fric', 'prev': prev, 'next': nxt, 'dur': d,
                        'voiced': voiced_frac(m0, m1), 'hnr': hnr_mean(m0, m1),
                        'lf': db(band_energy(x, 50, 400) / max(tot, 1e-12)),
                        'centroid': centroid(x), 'level': (rms_db(x) - vref) if vref is not None else None})
        elif ph in STOPS and nxt in VOWELS and d > 0.03:
            # release: largest rise of HF energy in [end - 35 ms, end + 20 ms]
            m = (et >= b - 0.035) & (et < b + 0.02)
            idx = np.where(m)[0]
            if len(idx) < 4:
                continue
            rise = env[idx[3:]] - env[idx[:-3]]
            tb = float(et[idx[3:][np.argmax(rise)]])
            v_on = first_voiced(tb, b + 0.2)
            nb = phones[k + 1][2]
            burst = seg(tb, tb + 0.01)
            out.append({'phone': ph, 'kind': 'stop', 'prev': prev, 'next': nxt, 'dur': d,
                        'closureVoiced': voiced_frac(a, a + 0.7 * (tb - a)) if tb - a > 0.02 else None,
                        'vot': (v_on - tb) if v_on is not None and v_on < nb else None,
                        'burstLevel': (rms_db(burst) - vref) if vref is not None else None,
                        'burstRise': float(np.max(rise)),
                        'burstCentroid': centroid(burst, 500)})
    return out


def main():
    mode = sys.argv[1]
    rng = None
    if '--ids' in sys.argv:
        i = sys.argv.index('--ids')
        rng = sys.argv[i + 1].split('-')
        del sys.argv[i:i + 2]
    keep = lambda uid: rng is None or (f'arctic_{rng[0]}' <= uid <= f'arctic_{rng[1]}')
    toks = []
    if mode == 'natural':
        wav_dir, align_dir = sys.argv[2:4]
        for jf in sorted(glob.glob(os.path.join(align_dir, 'arctic_*.json'))):
            a = json.load(open(jf))
            if not keep(a['id']):
                continue
            ph = [(p['phone'], p['start'], p['end']) for p in a['phones']]
            for t in analyse(os.path.join(wav_dir, a['id'] + '.wav'), ph):
                toks.append({**t, 'id': a['id']})
    elif mode == 'synth':
        d = sys.argv[2]
        for jf in sorted(glob.glob(os.path.join(d, 'plans', '*.json'))):
            p = json.load(open(jf))
            if not keep(p['id']):
                continue
            ph = [(s['phone'], s['start'], s['start'] + s['duration']) for s in p['segments']]
            for t in analyse(os.path.join(d, 'x', p['id'] + '.wav'), ph):
                toks.append({**t, 'id': p['id']})
    elif mode == 'compare':
        sets = [(os.path.basename(f).rsplit('.', 1)[0], json.load(open(f))) for f in sys.argv[2:]]
        compare(sets)
        return
    json.dump(toks, sys.stdout, default=float)


def med(v):
    v = [x for x in v if x is not None]
    return (float(np.median(v)), len(v)) if v else (None, 0)


def compare(sets):
    names = [n for n, _ in sets]
    def table(kind, phones, fields):
        print(f'\n### {kind}\n')
        print('| phone | measure | ' + ' | '.join(names) + ' |')
        print('|---|---|' + '---|' * len(names))
        for ph in phones:
            for f, fmt in fields:
                row = []
                for _, toks in sets:
                    m, n = med([t.get(f) for t in toks if t['phone'] == ph])
                    row.append('–' if m is None else (fmt.format(m) + f' ({n})'))
                print(f'| {ph} | {f} | ' + ' | '.join(row) + ' |')
    table('Stops (before a vowel)', 'p b t d k g'.split(),
          [('dur', '{:.3f}'), ('closureVoiced', '{:.2f}'), ('vot', '{:.3f}'), ('burstLevel', '{:.1f}'), ('burstRise', '{:.1f}'), ('burstCentroid', '{:.0f}')])
    table('Fricatives', 'f v θ ð s z ʃ ʒ'.split(),
          [('dur', '{:.3f}'), ('voiced', '{:.2f}'), ('hnr', '{:.1f}'), ('lf', '{:.1f}'), ('centroid', '{:.0f}'), ('level', '{:.1f}')])


if __name__ == '__main__':
    main()

"""
Recorded excitation: extract natural glottal excitation pulses from an aligned corpus, for the
formant backend's `source.excitation = 'recorded'` mode (residual-excited synthesis).

For long stressed vowels in the recordings, estimate the glottal flow derivative by a simplified
IAIF (Alku 1992): fit a 1st-order LPC to remove the overall source tilt, fit a 16th-order LPC to
the tilt-free signal (the vocal tract), and inverse-filter the original by the tract filter only,
so the pulse keeps the voice's own spectral tilt (a plain LPC residual is nearly white, and through
the formant filters it sounds buzzy and loses periodicity). Cut it into periods at the pitch marks. Each period is resampled to a fixed length so it can be
stretched to any f0, energy-normalised, and the set is pruned to the most typical pulses (closest
to the median shape) so one odd period never dominates.

    python3 scripts/speech/corpus/extract-pulses.py <wavDir> <alignDir> <out.json> [count]

Writes { length, pulses: [[...], ...], source } (floats, zero mean, unit RMS).
"""
import glob, json, os, sys
import numpy as np
import librosa

SR = 16000
# The last 50 ARCTIC b-set prompts are held out for evaluation against the natural recordings
# (scripts/speech/natural-compare.py); no unit or pulse may come from them.
HELD_OUT = lambda uid: uid >= 'arctic_b0490'
L = 256
VOWELS = {'iː', 'ɪ', 'e', 'æ', 'ʌ', 'ɑː', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'əʊ', 'aʊ'}


def lpc(x, order):
    return librosa.lpc(x * np.hanning(len(x)) + 1e-9 * np.random.default_rng(0).standard_normal(len(x)), order=order)


def glottal_derivative(seg, order=16):
    g = lpc(seg, 1)
    tilt_free = np.convolve(seg, g)[: len(seg)]
    vt = lpc(tilt_free, order)
    return np.convolve(seg, vt)[: len(seg)]


def main():
    wav_dir, align_dir, out = sys.argv[1:4]
    count = int(sys.argv[4]) if len(sys.argv) > 4 else 64
    index = {x['id']: x for x in json.load(open(os.path.join(align_dir, 'index.json')))}
    good = sorted(index.values(), key=lambda x: x['cost'])[: int(len(index) * 0.5)]
    pulses = []
    for u in good:
        if HELD_OUT(u['id']):
            continue
        a = json.load(open(os.path.join(align_dir, u['id'] + '.json')))
        y = None
        for p in a['phones']:
            if p['phone'] not in VOWELS or p['stress'] != 1 or p['end'] - p['start'] < 0.09:
                continue
            if y is None:
                y, _ = librosa.load(os.path.join(wav_dir, u['id'] + '.wav'), sr=SR)
            # the steady middle of the vowel only
            t0 = p['start'] + 0.3 * (p['end'] - p['start'])
            t1 = p['end'] - 0.3 * (p['end'] - p['start'])
            marks = [m for m in a['marks'] if t0 <= m <= t1]
            if len(marks) < 3:
                continue
            s0, s1 = int((marks[0] - 0.012) * SR), int((marks[-1] + 0.012) * SR)
            seg = y[max(0, s0):s1]
            res = glottal_derivative(seg)
            for m0, m1 in zip(marks, marks[1:]):
                i0, i1 = int(m0 * SR) - max(0, s0), int(m1 * SR) - max(0, s0)
                per = res[i0:i1]
                if not (SR / 300 < len(per) < SR / 60):
                    continue
                # start each pulse a little before the closure instant so the main excitation is intact
                shift = int(0.15 * len(per))
                per = res[max(0, i0 - shift): max(0, i0 - shift) + (i1 - i0)]
                if len(per) != i1 - i0:
                    continue
                q = np.interp(np.linspace(0, len(per) - 1, L), np.arange(len(per)), per)
                q = q - q.mean()
                q = q / (np.sqrt(np.mean(q ** 2)) + 1e-9)
                pulses.append(q)
        if len(pulses) > 4000:
            break
    P = np.array(pulses)
    med = np.median(P, axis=0)
    d = np.sqrt(np.mean((P - med) ** 2, axis=1))
    keep = P[np.argsort(d)[:count]]
    # order the kept pulses along their main axis of variation, so the synthesiser can drift
    # slowly through neighbouring shapes instead of jumping between unrelated ones every period
    c = keep - keep.mean(axis=0)
    pc = np.linalg.svd(c, full_matrices=False)[2][0]
    keep = keep[np.argsort(c @ pc)]
    json.dump({'length': L, 'source': 'CMU ARCTIC awb (Carnegie Mellon University, permissive licence)', 'pulses': [[round(float(x), 4) for x in q] for q in keep]},
              open(out, 'w'))
    print(f'{len(pulses)} periods from {len(good)} utterances; kept {len(keep)} most typical')


if __name__ == '__main__':
    main()

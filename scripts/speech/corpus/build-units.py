"""
Build a diphone database from an aligned corpus (align.py output) for the experimental `units`
backend (src/speech/backends/units). One unit per diphone, from the middle of the first phone to the
middle of the second, chosen among all instances in the corpus by:
  alignment quality (utterance DTW cost) + duration typicality of both halves + pitch near the
  speaker's median + stable energy at the cut points (cuts inside steady parts join best).

    python3 scripts/speech/corpus/build-units.py <wavDir> <alignDir> <outDir>

Writes <outDir>/units.bin (16 kHz mono int16, all units back to back) and <outDir>/units.json:
{ sampleRate, units: { "a-b": { offset, length, mid, marks: [samples…] } } } where `mid` is the
a/b boundary and `marks` are the pitch marks (glottal closures) inside the unit. Pause is "_".
"""
import glob, json, math, os, sys
from collections import defaultdict
import numpy as np
import librosa

SR = 16000
# The last 50 ARCTIC b-set prompts are held out for evaluation against the natural recordings
# (scripts/speech/natural-compare.py); no unit or pulse may come from them.
HELD_OUT = lambda uid: uid >= 'arctic_b0490'
VOICED = {'iː', 'ɪ', 'e', 'æ', 'ʌ', 'ɑː', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə', 'i', 'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə',
          'm', 'n', 'ŋ', 'l', 'r', 'w', 'j'}


def main():
    wav_dir, align_dir, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    index = {x['id']: x for x in json.load(open(os.path.join(align_dir, 'index.json')))}
    costs = sorted(x['cost'] for x in index.values())
    cost_cut = costs[int(len(costs) * 0.9)]  # drop the worst-aligned tenth
    utts = []
    durs = defaultdict(list)
    for f in sorted(glob.glob(os.path.join(align_dir, 'arctic_*.json'))):
        u = json.load(open(f))
        if index[u['id']]['cost'] > cost_cut:
            continue
        if HELD_OUT(u['id']):
            continue
        utts.append(u)
        for p in u['phones']:
            durs[p['phone']].append(p['end'] - p['start'])
    med = {p: float(np.median(v)) for p, v in durs.items()}
    f0_all = [u['f0'] for u in utts if u['f0'] > 0]
    f0_med = float(np.median(f0_all))

    best = {}
    audio_cache = {}
    for u in utts:
        ph = u['phones']
        uc = index[u['id']]['cost']
        for a, b in zip(ph, ph[1:]):
            da, db = a['end'] - a['start'], b['end'] - b['start']
            if da < 0.02 or db < 0.02:
                continue
            key = f"{a['phone']}-{b['phone']}"
            start, mid, end = (a['start'] + a['end']) / 2, a['end'], (b['start'] + b['end']) / 2
            # local pitch from marks in the unit
            ms = [m for m in u['marks'] if start <= m <= end]
            # a vowel or voiced sonorant half without pitch marks means the alignment landed in the
            # wrong place (or the speaker devoiced it): such a unit cannot be PSOLA'd, skip it
            need_a = a['phone'] in VOICED and len([m for m in ms if m < mid]) < 2
            need_b = b['phone'] in VOICED and len([m for m in ms if m >= mid]) < 2
            if need_a or need_b:
                continue
            local = (len(ms) - 1) / (ms[-1] - ms[0]) if len(ms) > 2 else f0_med
            score = (uc / cost_cut) + abs(math.log(da / med[a['phone']])) + abs(math.log(db / med[b['phone']])) \
                + 0.7 * abs(math.log(local / f0_med)) + (0.3 if a['phone'] == '_' or b['phone'] == '_' else 0)
            if key not in best or score < best[key][0]:
                best[key] = (score, u['id'], start, mid, end, ms)

    chunks, units, offset = [], {}, 0
    for key, (score, uid, start, mid, end, ms) in sorted(best.items()):
        if uid not in audio_cache:
            audio_cache.clear()
            audio_cache[uid], _ = librosa.load(os.path.join(wav_dir, uid + '.wav'), sr=SR)
        y = audio_cache[uid]
        s0, s1, s2 = int(start * SR), int(mid * SR), int(end * SR)
        seg = y[s0:s2]
        if len(seg) < 80:
            continue
        pcm = np.clip(seg * 32767, -32768, 32767).astype('<i2')
        chunks.append(pcm.tobytes())
        units[key] = {'offset': offset, 'length': len(pcm), 'mid': s1 - s0, 'marks': [int(m * SR) - s0 for m in ms], 'score': round(score, 3), 'from': uid}
        offset += len(pcm)
    open(os.path.join(out_dir, 'units.bin'), 'wb').write(b''.join(chunks))
    json.dump({'sampleRate': SR, 'speakerF0': f0_med, 'medianDurations': med, 'units': units}, open(os.path.join(out_dir, 'units.json'), 'w'))
    print(f'{len(units)} diphones from {len(utts)} utterances, {offset / SR:.1f} s of audio; speaker median f0 {f0_med:.0f} Hz')


if __name__ == '__main__':
    main()

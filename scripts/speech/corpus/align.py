"""
Synthesis-based alignment, step 2: align each recording with our own rendering of the same prompt
(synth-prompts.ts) by dynamic time warping on MFCCs, and carry the synthetic phone boundaries
across. Also extracts pitch marks (glottal closure instants) from the recording with Praat's
point process via parselmouth (GPL; offline data preparation only, nothing ships).

    python3 scripts/speech/corpus/align.py <wavDir> <synthDir> <outDir>

Writes <outDir>/<id>.json: {id, text, sr, phones: [{phone, start, end, word, stress}], marks: [s…],
f0: median Hz} and <outDir>/index.json with per-utterance DTW cost (high cost = suspect alignment,
for example where the speaker's accent differs from the SSB transcription).

Accuracy is that of DTW between different voices (typically 15–30 ms on boundaries); good enough
for diphone/unit candidates and duration statistics, not for phonetic research.
"""
import glob, json, os, sys
import numpy as np
import librosa
import parselmouth

SR = 16000
HOP = 0.005


def feats(y):
    m = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=20, n_fft=512, hop_length=int(HOP * SR), win_length=400, n_mels=40)
    m = m[1:]  # drop energy-like c0: voices differ in level
    m = (m - m.mean(axis=1, keepdims=True)) / (m.std(axis=1, keepdims=True) + 1e-6)  # per-utterance CMVN
    return m


def main():
    wav_dir, synth_dir, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for jf in sorted(glob.glob(os.path.join(synth_dir, '*.json'))):
        meta = json.load(open(jf))
        uid = meta['id']
        nat_path = os.path.join(wav_dir, uid + '.wav')
        if not os.path.exists(nat_path):
            continue
        nat, _ = librosa.load(nat_path, sr=SR)
        syn, _ = librosa.load(os.path.join(synth_dir, uid + '.wav'), sr=SR)
        # trim the recording's leading/trailing silence to match the synthetic lead/tail pauses loosely
        D, wp = librosa.sequence.dtw(X=feats(syn), Y=feats(nat), metric='cosine', step_sizes_sigma=np.array([[1, 1], [1, 2], [2, 1]]),
                                     weights_mul=np.array([1, 1, 1]))
        wp = wp[::-1]
        cost = float(D[-1, -1] / len(wp))
        # map synthetic frame → natural frame (mean over the path)
        syn_to_nat = {}
        for a, b in wp:
            syn_to_nat.setdefault(int(a), []).append(int(b))
        n_syn = max(syn_to_nat) + 1

        def to_nat(t):
            k = min(n_syn - 1, max(0, int(round(t / HOP))))
            while k not in syn_to_nat and k > 0:
                k -= 1
            return float(np.mean(syn_to_nat.get(k, [0])) * HOP)

        phones = []
        for s in meta['segments']:
            a, b = to_nat(s['start']), to_nat(s['start'] + s['duration'])
            phones.append({'phone': s['phone'], 'start': round(a, 4), 'end': round(max(b, a + 0.005), 4), 'word': s['word'],
                           'stress': s['stress'], 'role': s['role']})
        snd = parselmouth.Sound(nat_path)
        pitch = snd.to_pitch(time_step=0.005, pitch_floor=60, pitch_ceiling=300)
        pp = parselmouth.praat.call([snd, pitch], 'To PointProcess (cc)')
        n = parselmouth.praat.call(pp, 'Get number of points')
        marks = [round(parselmouth.praat.call(pp, 'Get time from index', i + 1), 5) for i in range(n)]
        f0s = pitch.selected_array['frequency']
        f0 = float(np.median(f0s[f0s > 0])) if (f0s > 0).any() else 0.0
        json.dump({'id': uid, 'text': meta['text'], 'sr': snd.sampling_frequency, 'phones': phones, 'marks': marks, 'f0': f0},
                  open(os.path.join(out_dir, uid + '.json'), 'w'))
        index.append({'id': uid, 'cost': round(cost, 4), 'phones': len(phones), 'marks': len(marks), 'f0': round(f0, 1)})
    json.dump(index, open(os.path.join(out_dir, 'index.json'), 'w'), indent=0)
    costs = sorted(x['cost'] for x in index)
    print(f'aligned {len(index)} utterances; DTW cost median {costs[len(costs) // 2]:.3f}, 90th pct {costs[int(len(costs) * 0.9)]:.3f}')


if __name__ == '__main__':
    main()

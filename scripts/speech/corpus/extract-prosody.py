"""
Natural prosody for fitting the prosody model: per utterance, the aligned phone timings
(align.py) and a Praat pitch track of the recording. Offline data preparation only; Praat runs
through praat-parselmouth (GPL) and nothing of it ships.

    python3 scripts/speech/corpus/extract-prosody.py <wavDir> <alignDir> <out.json>

Writes {id: {text, phones: [[phone, start, end, stress, word], ...], f0: [Hz or 0 every 10 ms]}}.
"""
import glob, json, os, sys
import parselmouth

STEP = 0.01


def main():
    wav_dir, align_dir, out = sys.argv[1:4]
    data = {}
    for jf in sorted(glob.glob(os.path.join(align_dir, 'arctic_*.json'))):
        a = json.load(open(jf))
        snd = parselmouth.Sound(os.path.join(wav_dir, a['id'] + '.wav'))
        pitch = snd.to_pitch_ac(time_step=STEP, pitch_floor=60, pitch_ceiling=300)
        n = int(snd.duration / STEP)
        f0 = [round(pitch.get_value_at_time(k * STEP) or 0, 1) for k in range(n)]
        f0 = [0 if v != v else v for v in f0]  # NaN = unvoiced
        data[a['id']] = {
            'text': a['text'],
            'phones': [[p['phone'], round(p['start'], 3), round(p['end'], 3), p.get('stress', 0), p.get('word', -1)] for p in a['phones']],
            'f0': f0,
        }
    json.dump(data, open(out, 'w'))
    print(f'{len(data)} utterances -> {out}')


if __name__ == '__main__':
    main()

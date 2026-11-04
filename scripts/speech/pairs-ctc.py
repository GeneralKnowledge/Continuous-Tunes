"""
Forced-choice minimal-pair discrimination with a CTC recogniser (NeMo Citrinet through
onnxruntime): for each item, the log-likelihood of the text with the target word against the same
text with its partner (pat → bat, sue → zoo). CTC has no language model, so the margin comes from
the acoustics alone; free transcripts of single words are mostly the recogniser's guesses.

    python3 scripts/speech/pairs-ctc.py <items.json> <dir> [<dir> ...] [--model ~/models/sherpa-onnx-nemo-ctc-en-citrinet-512]

Reports, per contrast, voicing direction and context: the share of items where the target wins
(chance is 50%) and the mean margin in nats. Writes <dir>/ctc.json with per-item margins.
Items too short for their token sequence (single words, at 80 ms per output frame) are skipped.
Development tool only (needs onnxruntime and kaldi-native-fbank).
"""
import glob, json, os, re, sys
from collections import defaultdict
import numpy as np
import librosa
import kaldi_native_fbank as knf
import onnxruntime as ort


def fbank(path):
    y, _ = librosa.load(path, sr=16000)
    o = knf.FbankOptions()
    o.frame_opts.dither = 0
    o.frame_opts.snip_edges = False
    o.frame_opts.samp_freq = 16000
    o.mel_opts.num_bins = 80
    fb = knf.OnlineFbank(o)
    fb.accept_waveform(16000, (y * 32768).tolist())
    fb.input_finished()
    f = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)])
    return ((f - f.mean(0, keepdims=True)) / (f.std(0, keepdims=True) + 1e-5)).astype(np.float32)


class Tok:
    def __init__(self, path):
        self.id = {}
        for line in open(path, encoding='utf-8'):
            s, i = line.rstrip('\n').rsplit(' ', 1)
            self.id[s] = int(i)
        self.maxlen = max(len(s) for s in self.id)

    def encode(self, text):
        out = []
        for w in re.sub(r"[^a-z' ]", ' ', text.lower()).split():
            s = '▁' + w
            while s:
                for L in range(min(len(s), self.maxlen), 0, -1):
                    if s[:L] in self.id:
                        out.append(self.id[s[:L]]); s = s[L:]; break
                else:
                    s = s[1:]
        return out


def ctc_ll(lp, y, blank):
    """log P(y | x) for CTC log-probs lp (T, V)."""
    ext = [blank]
    for t in y:
        ext += [t, blank]
    S, T = len(ext), lp.shape[0]
    a = np.full(S, -np.inf)
    a[0] = lp[0, ext[0]]
    if S > 1:
        a[1] = lp[0, ext[1]]
    for t in range(1, T):
        b = np.full(S, -np.inf)
        for s in range(S):
            v = a[s]
            if s > 0:
                v = np.logaddexp(v, a[s - 1])
            if s > 1 and ext[s] != blank and ext[s] != ext[s - 2]:
                v = np.logaddexp(v, a[s - 2])
            b[s] = v + lp[t, ext[s]]
        a = b
    return float(np.logaddexp(a[-1], a[-2]) if S > 1 else a[-1])


def main():
    args = sys.argv[1:]
    model = os.path.expanduser('~/models/sherpa-onnx-nemo-ctc-en-citrinet-512')
    if '--model' in args:
        i = args.index('--model'); model = os.path.expanduser(args[i + 1]); del args[i:i + 2]
    items = json.load(open(args[0]))
    tok = Tok(os.path.join(model, 'tokens.txt'))
    blank = len(tok.id) - 1  # NeMo CTC: blank is the last index
    sess = ort.InferenceSession(os.path.join(model, 'model.int8.onnx'))
    for d in args[1:]:
        res = {}
        stats = defaultdict(list)
        for it in items:
            wav = os.path.join(d, 'x', it['id'] + '.wav')
            if not os.path.exists(wav):
                continue
            f = fbank(wav)[None].transpose(0, 2, 1)
            lp = sess.run(None, {'audio_signal': f, 'length': np.array([f.shape[2]], dtype=np.int64)})[0][0]
            swap = re.sub(rf"\b{re.escape(it['target'])}\b", it['partner'], it['text'], count=1, flags=re.I)
            a, b = ctc_ll(lp, tok.encode(it['text']), blank), ctc_ll(lp, tok.encode(swap), blank)
            if not (np.isfinite(a) and np.isfinite(b)):
                continue  # too short for the token sequence at 80 ms per output frame
            m = a - b
            res[it['id']] = m
            v = 'voiced' if it['voiced'] else 'voiceless'
            for key in [('all',), ('contrast', it['contrast']), ('voicing', v), ('context', it['context']), ('cv', it['contrast'], v)]:
                stats[key].append(m)
        json.dump(res, open(os.path.join(d, 'ctc.json'), 'w'), indent=1)
        print(f'\n## {d}\n| group | target wins | mean margin (nats) | n |\n|---|---|---|---|')
        for key in sorted(stats, key=lambda k: (len(k), k)):
            v = np.array(stats[key])
            print(f"| {' '.join(key)} | {100 * (v > 0).mean():.0f}% | {v.mean():+.2f} | {len(v)} |")


if __name__ == '__main__':
    main()

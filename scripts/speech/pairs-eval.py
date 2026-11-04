"""
Score the minimal-pair corpus (consonant-corpus.ts) from recogniser transcripts.

    python3 scripts/speech/pairs-eval.py <items.json> <dir> [<dir> ...]

Each <dir> holds x/<id>.wav and the asr*.json files from asr_whisper.py. Per item and recogniser
the target word is: heard (the word itself), confused (its partner was heard instead) or missed
(neither). Reports target accuracy and partner confusions per contrast, per voicing (which way
the confusions go), per context, a consonant confusion matrix, and overall WER of the items.
"""
import glob, json, os, re, sys
from collections import defaultdict

norm = lambda s: re.sub(r"[^a-z' ]", ' ', s.lower()).split()


def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    D = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        p, D[0] = D[0], i
        for j in range(1, len(h) + 1):
            p, D[j] = D[j], min(D[j] + 1, D[j - 1] + 1, p + (r[i - 1] != h[j - 1]))
    return D[-1], len(r)


def forms(w):
    # plural/possessive and common spellings the recogniser may use for the same word
    alt = {'thy': ['thy', 'thai'], 'thigh': ['thigh'], 'eyes': ['eyes', "i's", 'ayes'], 'sue': ['sue', 'soo'], 'zoo': ['zoo', 'zoos'],
           'die': ['die', 'dye'], 'tie': ['tie', 'thai'], 'pea': ['pea', 'pee', 'p'], 'bee': ['bee', 'be', 'b'], 'seal': ['seal', 'seel'],
           'teethe': ['teethe'], 'bus': ['bus'], 'buzz': ['buzz']}
    return set(alt.get(w, [w])) | {w + 's'}


def main():
    items = {i['id']: i for i in json.load(open(sys.argv[1]))}
    for d in sys.argv[2:]:
        asr = {}
        for f in sorted(glob.glob(os.path.join(d, 'asr*.json'))):
            name = os.path.basename(f)[4:-5] or 'base'
            asr[name] = {os.path.basename(k)[:-4]: v for k, v in json.load(open(f)).items()}
        if not asr:
            print(d, 'no transcripts'); continue
        stats = defaultdict(lambda: [0, 0, 0])  # heard, confused, total
        conf = defaultdict(lambda: defaultdict(int))
        we = [0, 0]
        for model, hyp in asr.items():
            for iid, it in items.items():
                h = hyp.get(iid)
                if h is None:
                    continue
                e, n = wer(it['text'], h); we[0] += e; we[1] += n
                words = set(norm(h))
                tgt = bool(words & forms(it['target']))
                par = bool(words & forms(it['partner'])) and not tgt
                cons = it['contrast'].split('-')[1 if it['voiced'] else 0]
                other = it['contrast'].split('-')[0 if it['voiced'] else 1]
                conf[cons][cons if tgt else other if par else 'miss'] += 1
                for key in [('all',), ('contrast', it['contrast']), ('voicing', 'voiced' if it['voiced'] else 'voiceless'), ('context', it['context']),
                            ('position', it['position']), ('model', model), ('cv', it['contrast'], 'voiced' if it['voiced'] else 'voiceless')]:
                    s = stats[key]; s[0] += tgt; s[1] += par; s[2] += 1
        print(f'\n## {d}  (WER of the items {100 * we[0] / max(1, we[1]):.1f}%)')
        print('| group | target heard | partner heard instead | n |\n|---|---|---|---|')
        for key in sorted(stats, key=lambda k: (len(k), k)):
            h, c, n = stats[key]
            print(f"| {' '.join(key)} | {100 * h / n:.0f}% | {100 * c / n:.0f}% | {n} |")
        print('\nconfusions (row: consonant spoken):', {k: dict(v) for k, v in conf.items()})


if __name__ == '__main__':
    main()

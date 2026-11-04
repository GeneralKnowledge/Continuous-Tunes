"""
Voice experiments: parameter sweeps and CMA-ES search over SpeechVoice fields, scored on the
speech benchmark with several offline recognisers. Development tool; nothing here ships.

Every evaluated voice is written to <out>/voices/<hash>.json and logged as one JSON line in
<out>/experiments.jsonl with the git commit, the parameters, the seeds and every objective kept
separate (WER per recogniser on the core set, diagnostic accuracy per recogniser and per
contrast). Re-running a logged voice at the same commit reproduces its audio bit for bit.

    # one-parameter sweep, three seeds each
    python3 scripts/speech/experiment.py sweep out/ --base alder --param source.rd --values 0.7,0.9,1.2 \
        --models ~/models/sherpa-onnx-whisper-base.en,~/models/sherpa-onnx-nemo-ctc-en-citrinet-512

    # CMA-ES over several bounded parameters (pip install cmaes; MIT)
    python3 scripts/speech/experiment.py cmaes out/ --base alder --budget 40 \
        --bounds articulation.consonantStrength:0.6:1.6,articulation.transitionMs:30:80,source.rd:0.6:1.6

Objectives are never collapsed in the log. For CMA-ES the search minimises
  mean core WER + (1 − mean diagnostic accuracy)
across the chosen recognisers, i.e. intelligibility only; naturalness still needs listening
(scripts/speech/ab.ts). Keep bounds inside VOICE_RANGES (voice.ts); validateVoice clamps anyway.
"""
import argparse, copy, json, os, statistics, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_MODELS = [os.path.expanduser(f'~/models/{m}') for m in (
    'sherpa-onnx-whisper-base.en', 'sherpa-onnx-whisper-small.en',
    'sherpa-onnx-nemo-ctc-en-citrinet-512', 'sherpa-onnx-zipformer-en-2023-06-26')]


def run(cmd):
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def base_voice(spec):
    if spec.endswith('.json'):
        with open(spec) as f:
            return json.load(f)
    out = subprocess.run(['npx', 'tsx', '-e', f"import {{ getVoicePreset }} from './src/speech'; console.log(JSON.stringify(getVoicePreset({json.dumps(spec)})))"],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def set_path(voice, path, value):
    v = copy.deepcopy(voice)
    group, key = path.split('.')
    v[group][key] = value
    return v


def evaluate(out, voice, seeds, models, set_name='all'):
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    os.makedirs(os.path.join(out, 'voices'), exist_ok=True)
    tmp = os.path.join(out, 'voices', 'candidate.json')
    with open(tmp, 'w') as f:
        json.dump(voice, f)
    log = os.path.join(out, 'experiments.jsonl')
    n = sum(1 for _ in open(log)) if os.path.exists(log) else 0
    runs = []
    for seed in seeds:
        d = os.path.join(out, 'runs', f'{n:04d}-seed{seed}')
        bench = ['npx', 'tsx', 'scripts/speech/benchmark.ts', d, tmp, '--set', set_name, '--seed', str(seed)]
        run(bench)
        run([sys.executable, 'scripts/speech/asr_whisper.py', d, *models])
        run(bench)
        with open(os.path.join(d, 'report.json')) as f:
            s = json.load(f)['summary'][0]
        runs.append(s)
    h = runs[0]['voiceHash']
    os.replace(tmp, os.path.join(out, 'voices', f'{h}.json'))
    mean = statistics.mean
    wer = {m: mean(r['werByModel'][m] for r in runs) for m in runs[0]['werByModel'] if runs[0]['werByModel'][m] is not None}
    diag = {m: mean(r['diagnosticByModel'][m]['accuracy'] for r in runs) for m in runs[0]['diagnosticByModel'] if runs[0]['diagnosticByModel'][m]['accuracy'] is not None}
    contrasts = {}
    for r in runs:
        for m, d in r['diagnosticByModel'].items():
            for c, v in d['byContrast'].items():
                contrasts.setdefault(c, []).append(v)
    rec = {
        'commit': commit, 'voiceHash': h, 'voice': voice, 'seeds': seeds,
        'werByModel': wer, 'meanWer': mean(wer.values()) if wer else None,
        'diagnosticByModel': diag, 'meanDiagnostic': mean(diag.values()) if diag else None,
        'contrasts': {c: mean(v) for c, v in contrasts.items()},
        'clipped': sum(r['clipped'] for r in runs), 'reproducible': all(r['reproducible'] for r in runs),
    }
    with open(os.path.join(out, 'experiments.jsonl'), 'a') as f:
        f.write(json.dumps(rec) + '\n')
    print(f"{h} WER {100 * rec['meanWer']:.1f}% diag {100 * rec['meanDiagnostic']:.1f}%", flush=True)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['sweep', 'cmaes', 'eval'])
    ap.add_argument('out')
    ap.add_argument('--base', default='alder')
    ap.add_argument('--param')
    ap.add_argument('--values')
    ap.add_argument('--bounds')
    ap.add_argument('--budget', type=int, default=30)
    ap.add_argument('--seeds', default='1,2,3')
    ap.add_argument('--models', default=','.join(DEFAULT_MODELS))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    voice = base_voice(a.base)
    seeds = [int(s) for s in a.seeds.split(',')]
    models = [os.path.expanduser(m) for m in a.models.split(',')]
    if a.mode == 'eval':
        evaluate(a.out, voice, seeds, models)
    elif a.mode == 'sweep':
        for v in a.values.split(','):
            evaluate(a.out, set_path(voice, a.param, float(v)), seeds, models)
    else:
        import numpy as np
        from cmaes import CMA
        params = [(p, float(lo), float(hi)) for p, lo, hi in (b.split(':') for b in a.bounds.split(','))]
        lo = np.array([p[1] for p in params]); hi = np.array([p[2] for p in params])
        x0 = np.array([voice[p.split('.')[0]][p.split('.')[1]] for p, *_ in params])
        # search in [0, 1] per parameter so one step size suits all of them
        opt = CMA(mean=(x0 - lo) / (hi - lo), sigma=0.2, bounds=np.array([[0, 1]] * len(params)), seed=1)
        done = 0
        while done < a.budget:
            sols = []
            for _ in range(opt.population_size):
                z = opt.ask()
                v = voice
                for (p, l, h), zi in zip(params, z):
                    v = set_path(v, p, float(l + zi * (h - l)))
                r = evaluate(a.out, v, seeds, models)
                sols.append((z, r['meanWer'] + (1 - r['meanDiagnostic'])))
                done += 1
            opt.tell(sols)


if __name__ == '__main__':
    main()

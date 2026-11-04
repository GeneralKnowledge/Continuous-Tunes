"""
Blind multi-engine listening test (MUSHRA-style, without the anchor): the same sentences from
several engines, plus the natural recording as a hidden reference, in a per-item random order.
The listener scores each 0–100 for naturalness and may note intelligibility problems; Export
resolves the hidden labels and gives the mean score per engine.

    python3 scripts/speech/listen-multi.py <outDir> <naturalWavDir> label=dir [label=dir …] [--items 8] [--seed 1]

Items are the held-out prompts (ids >= arctic_b0490) present in every engine directory. Audio is
copied (resampled to 16 kHz mono int16) into <outDir>/<item>/<n>.wav; <outDir>/index.html works
offline from the folder.
"""
import glob, html, json, os, random, sys
import numpy as np
import librosa
import soundfile as sf

SR = 16000


def main():
    args = sys.argv[1:]
    opt = {}
    for k in ('items', 'seed'):
        if f'--{k}' in args:
            i = args.index(f'--{k}'); opt[k] = int(args[i + 1]); del args[i:i + 2]
    out, nat = args[0], args[1]
    engines = [a.split('=', 1) for a in args[2:]] + [['natural', nat]]
    ids = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(nat, 'arctic_b*.wav')) if os.path.basename(p)[:-4] >= 'arctic_b0490')
    ids = [i for i in ids if all(os.path.exists(os.path.join(d, i + '.wav')) for _, d in engines)]
    rng = random.Random(opt.get('seed', 1))
    ids = sorted(rng.sample(ids, min(opt.get('items', 8), len(ids))))
    texts = {}
    prompts = os.path.join(nat, '..', 'etc', 'txt.done.data')
    if os.path.exists(prompts):
        for line in open(prompts):
            parts = line.strip().strip('()').strip().split(' ', 1)
            if len(parts) == 2:
                texts[parts[0]] = parts[1].strip().strip('"')
    items = []
    for uid in ids:
        order = list(range(len(engines)))
        rng.shuffle(order)
        os.makedirs(os.path.join(out, uid), exist_ok=True)
        for n, e in enumerate(order):
            y, _ = librosa.load(os.path.join(engines[e][1], uid + '.wav'), sr=SR)
            y, _ = librosa.effects.trim(y, top_db=40)
            y = 0.5 * y / (np.max(np.abs(y)) + 1e-9)  # equal peak level so loudness does not decide
            sf.write(os.path.join(out, uid, f'{n + 1}.wav'), y, SR, subtype='PCM_16')
        items.append({'id': uid, 'text': texts.get(uid, ''), 'key': [engines[e][0] for e in order]})
    rows = []
    for it in items:
        cells = ''.join(
            f'<div class="s"><span>{n + 1}</span><audio controls preload="metadata" src="{it["id"]}/{n + 1}.wav"></audio>'
            f'<input type="range" id="r-{it["id"]}-{n}" aria-label="score for version {n + 1}" min="0" max="100" value="50" data-i="{it["id"]}" data-n="{n}"><output>50</output></div>'
            for n in range(len(it['key'])))
        rows.append(f'<section><h2>{html.escape(it["text"])}</h2>{cells}</section>')
    page = f"""<title>Speech engine listening test</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,600&display=swap">
<style>
/* one column of sentences; each a stack of numbered players with a score slider */
:root{{--bg:#f6f7f4;--fg:#1c211d;--mut:#5f6a62;--line:#dde2dc;--acc:#2f6f5a;--card:#ffffff;
--display:"Source Serif 4",Georgia,serif;--body:"Atkinson Hyperlegible",system-ui,sans-serif}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#151a17;--fg:#e8ede8;--mut:#9aa69d;--line:#2c3530;--acc:#7cc4a8;--card:#1c2320;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#151a17;--fg:#e8ede8;--mut:#9aa69d;--line:#2c3530;--acc:#7cc4a8;--card:#1c2320;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font:16px/1.55 var(--body);padding-block:24px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
main{{max-width:720px;margin:0 auto;display:grid;gap:20px}}
h1{{font:600 1.6rem/1.2 var(--display);margin:0;text-wrap:balance}}
h2{{font:600 1.05rem/1.35 var(--display);margin:0 0 10px;text-wrap:balance}}
p{{color:var(--mut);margin:0;max-width:65ch}}
section{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}}
.s{{display:grid;grid-template-columns:1.5rem minmax(0,1fr) minmax(90px,130px) 2rem;gap:8px;align-items:center;padding:3px 0}}
.s span{{color:var(--mut);font-variant-numeric:tabular-nums}}
audio{{width:100%;height:34px;min-width:0}} input[type=range]{{accent-color:var(--acc);width:100%}}
output{{text-align:right;font-variant-numeric:tabular-nums;color:var(--mut)}}
button{{font:700 1rem var(--body);padding:10px 18px;border-radius:8px;border:0;background:var(--acc);color:var(--bg);cursor:pointer;justify-self:start}}
button:focus-visible,input:focus-visible{{outline:2px solid var(--acc);outline-offset:2px}}
pre{{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0;font-variant-numeric:tabular-nums;overflow-x:auto}}
pre:empty{{display:none}}
@media (max-width:480px){{.s{{grid-template-columns:1.2rem minmax(0,1fr) 2rem}} .s input{{grid-column:2/3}}}}
</style>
<main>
<h1>Which sounds most like a real person?</h1>
<p>Each sentence is spoken by {len(engines) - 1} speech engines and one real recording, in a different random order every time. Score each from 0 (clearly synthetic or hard to follow) to 100 (indistinguishable from a person). Levels are matched, so loudness is no clue. Press the button at the end to reveal which was which.</p>
{''.join(rows)}
<button id="x" type="button">Reveal and score</button><pre id="r"></pre>
</main>
<script>
const KEY={json.dumps({it['id']: it['key'] for it in items})};
document.querySelectorAll('input').forEach(r=>r.addEventListener('input',()=>r.nextElementSibling.value=r.value));
document.getElementById('x').onclick=()=>{{const s={{}};document.querySelectorAll('input').forEach(r=>{{const e=KEY[r.dataset.i][+r.dataset.n];(s[e]=s[e]||[]).push(+r.value)}});
const rows=Object.entries(s).map(([e,v])=>[e,v.reduce((a,b)=>a+b,0)/v.length]).sort((a,b)=>b[1]-a[1]);
document.getElementById('r').textContent='mean score per engine\n'+rows.map(([e,m])=>e.padEnd(22)+m.toFixed(1)).join('\n')+'\n\nraw: '+JSON.stringify(s)}};
</script>"""
    open(os.path.join(out, 'index.html'), 'w').write(page)
    print(f'{len(items)} items × {len(engines)} versions → {out}/index.html')


if __name__ == '__main__':
    main()

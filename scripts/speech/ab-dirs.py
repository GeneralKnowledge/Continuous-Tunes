"""
Blind paired A/B listening test from two folders of renders (any engine, e.g. Strudel renders).
Each pair plays the same sentence as "1" and "2" in a per-item random order; the listener picks
the one that sounds more like a person, or "same". Reveal gives the tally with the order resolved.
Levels are matched (RMS), so loudness is no clue. Picks are kept in the browser while scoring.

    python3 scripts/speech/ab-dirs.py <outDir> labelA=<dir> labelB=<dir> id[=text] [id[=text] ...] [--seed 1] [--ask clear]

--ask clear asks which version says the item's words more clearly (for consonant tests, with the
text naming the word to listen for) instead of which sounds more human.

Each id names <dir>/<id>.wav in both folders. The page is <outDir>/index.html, audio is
<outDir>/<id>/<1|2>.wav.
"""
import html, json, os, random, sys
import numpy as np
import soundfile as sf


def load(path):
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    x = x.mean(axis=1)
    rms = np.sqrt(np.mean(x ** 2)) or 1.0
    x = x * (0.08 / rms)
    return np.clip(x, -0.99, 0.99), sr


def main():
    args = sys.argv[1:]
    seed = 1
    if '--seed' in args:
        i = args.index('--seed'); seed = int(args[i + 1]); del args[i:i + 2]
    ask = 'human'
    if '--ask' in args:
        i = args.index('--ask'); ask = args[i + 1]; del args[i:i + 2]
    q = ASK[ask]
    out = args[0]
    (la, da), (lb, db) = [a.split('=', 1) for a in args[1:3]]
    items = [a.split('=', 1) if '=' in a else [a, ''] for a in args[3:]]
    rng = random.Random(seed)
    key = {}
    sections = []
    for iid, text in items:
        flip = rng.random() < 0.5
        order = [lb, la] if flip else [la, lb]
        key[iid] = order
        os.makedirs(os.path.join(out, iid), exist_ok=True)
        for n, lab in enumerate(order, 1):
            x, sr = load(os.path.join(da if lab == la else db, iid + '.wav'))
            sf.write(os.path.join(out, iid, f'{n}.wav'), x, sr, subtype='PCM_16')
        name = html.escape(iid)
        sections.append(
            f'<section data-i="{name}"><h2>{html.escape(text) or name}</h2><div class="pair">'
            + ''.join(f'<div class="p"><span>{n}</span><audio controls preload="metadata" src="{name}/{n}.wav"></audio></div>' for n in (1, 2))
            + f'</div><div class="pick" role="group" aria-label="{q["h1"]}">'
            + f'<button type="button" data-v="1">1 {q["b"]}</button><button type="button" data-v="0">Same</button><button type="button" data-v="2">2 {q["b"]}</button></div></section>'
        )
    page = TEMPLATE.replace('%H1%', q['h1']).replace('%INTRO%', q['p']).replace('%SECTIONS%', '\n'.join(sections)).replace('%KEY%', json.dumps(key)).replace('%A%', la).replace('%B%', lb).replace('%N%', str(len(items)))
    open(os.path.join(out, 'index.html'), 'w').write(page)
    print(f'{len(items)} pairs ({la} vs {lb}) -> {out}/index.html')


ASK = {
    'human': {'h1': 'Which one sounds more like a person?', 'b': 'sounds more human',
              'p': '%N% sentences, each spoken twice by the Strudel voice: two versions, in a random order every time, at the same loudness. Listen to both and pick the one that sounds more human, or Same if you can\'t tell. Press Reveal at the end and paste the result back.'},
    'clear': {'h1': 'Which one says the word more clearly?', 'b': 'is clearer',
              'p': '%N% items, each spoken twice by the Strudel voice: two versions, in a random order every time, at the same loudness. Each heading names the word to listen for and the word it could be mistaken for. Pick the version where the word is easier to tell apart, or Same if you can\'t tell. Press Reveal at the end and paste the result back.'},
}

TEMPLATE = '''<title>Strudel voice A/B</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,600&display=swap">
<style>
:root{--bg:#f6f7f4;--fg:#1c211d;--mut:#5f6a62;--line:#dde2dc;--acc:#2f6f5a;--accfg:#ffffff;--card:#ffffff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141815;--fg:#e4e9e3;--mut:#9aa69d;--line:#2c332e;--acc:#7cc4a8;--accfg:#10231b;--card:#1b201c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141815;--fg:#e4e9e3;--mut:#9aa69d;--line:#2c332e;--acc:#7cc4a8;--accfg:#10231b;--card:#1b201c;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:16px/1.55 "Atkinson Hyperlegible",system-ui,sans-serif;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:46rem;margin:0 auto;padding-block:2rem 4rem;display:grid;gap:1.25rem}
h1{font:600 1.9rem/1.2 "Source Serif 4",Georgia,serif;margin:0;text-wrap:balance}
h2{font:600 1.1rem/1.35 "Source Serif 4",Georgia,serif;margin:0;text-wrap:balance}
p{margin:0;color:var(--mut);max-width:65ch}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;display:grid;gap:.75rem;min-width:0}
.pair{display:grid;gap:.5rem}
.p{display:flex;align-items:center;gap:.6rem;min-width:0}
.p span{font-weight:700;width:1.2rem;text-align:center}
audio{width:100%;min-width:0;height:36px}
.pick{display:flex;flex-wrap:wrap;gap:.5rem}
button{font:inherit;padding:.45rem .8rem;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button.sel{background:var(--acc);color:var(--accfg);border-color:var(--acc)}
#x{justify-self:start;background:var(--acc);color:var(--accfg);border-color:var(--acc);font-weight:700}
pre{white-space:pre-wrap;margin:0;font-size:.9rem}
</style>
<main>
<h1>%H1%</h1>
<p>%INTRO%</p>
%SECTIONS%
<button id="x" type="button">Reveal</button><pre id="r"></pre>
</main>
<script>
const KEY=%KEY%;const SAVE='ab-dirs-%A%-%B%';let picks={};try{picks=JSON.parse(localStorage.getItem(SAVE)||'{}')}catch(e){}
document.querySelectorAll('section').forEach(s=>{const i=s.dataset.i;const bs=s.querySelectorAll('button');
const show=()=>bs.forEach(b=>b.classList.toggle('sel',picks[i]===b.dataset.v));show();
bs.forEach(b=>b.onclick=()=>{picks[i]=b.dataset.v;show();try{localStorage.setItem(SAVE,JSON.stringify(picks))}catch(e){}})});
document.getElementById('x').onclick=()=>{const t={'%A%':0,'%B%':0,same:0,unrated:0};const items={};
for(const i in KEY){const p=picks[i];const w=p===undefined?'unrated':p==='0'?'same':KEY[i][+p-1];t[w]++;items[i]=w}
document.getElementById('r').textContent=JSON.stringify({...t,items})};
</script>
'''

if __name__ == '__main__':
    main()

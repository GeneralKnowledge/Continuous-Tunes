"""
Render exported SpeechPlans (scripts/speech/export-plans.ts) with engines that cannot ship in the
app, so they can be compared with the built-in backends on identical phones, durations and pitch.
Research tool only: none of these engines or voices is a dependency of Continuous-Tunes.

    python3 scripts/speech/external/render.py <engine> <plansDir> <outDir>

Engines (each needs a local build; paths from environment variables):
  mbrola  MBROLA (AGPL-3.0) with the en1 British diphone voice (CSTR "Roger", usable only with
          the MBROLA program). MBROLA_BIN, MBROLA_VOICE. Same durations and pitch as the plan.
  vtl     VocalTractLab backend (GPL-3.0), articulatory 3D tract + glottis, German speaker JD3.
          VTL_LIB (libVocalTractLabApi.so), VTL_SPEAKER (JD3.speaker). Same durations; the
          plan's pitch replaces VTL's default f0 tier.
  tgsb    TGSpeechBox (MIT) tgsbRender, en-gb pack. TGSB_DIR (repo root with build/). It takes IPA
          and applies its own timing and Fujisaki pitch: a whole-system comparison, not same-plan.

Writes <outDir>/<id>.wav (16-bit mono) for every <id>.json.
"""
import ctypes, glob, json, math, os, re, struct, subprocess, sys, tempfile, wave

# ---------------------------------------------------------------- phone maps (SSB IPA → engine)
MBROLA = {
    'p': 'p', 'b': 'b', 't': 't', 'd': 'd', 'k': 'k', 'g': 'g', 'tʃ': 'tS', 'dʒ': 'dZ', 'f': 'f', 'v': 'v',
    'θ': 'T', 'ð': 'D', 's': 's', 'z': 'z', 'ʃ': 'S', 'ʒ': 'Z', 'h': 'h', 'm': 'm', 'n': 'n', 'ŋ': 'N',
    'l': 'l', 'r': 'r', 'w': 'w', 'j': 'j',
    'iː': 'i:', 'ɪ': 'I', 'e': 'e', 'æ': '{', 'ʌ': 'V', 'ɑː': 'A:', 'ɒ': 'Q', 'ɔː': 'O:', 'ʊ': 'U', 'uː': 'u:',
    'ɜː': '3:', 'ə': '@', 'i': 'I', 'eɪ': 'eI', 'aɪ': 'aI', 'ɔɪ': 'OI', 'əʊ': '@U', 'aʊ': 'aU', 'ɪə': 'I@',
    'eə': 'e@', 'ʊə': 'U@', '_': '_',
}
# VocalTractLab's segment converter knows German SAMPA. English sounds without a German
# equivalent are approximated (r → uvular, w → short u, diphthongs → two vowels).
VTL = {
    'p': ['p'], 'b': ['b'], 't': ['t'], 'd': ['d'], 'k': ['k'], 'g': ['g'], 'tʃ': ['tS'], 'dʒ': ['d', 'Z'],
    'f': ['f'], 'v': ['v'], 'θ': ['T'], 'ð': ['D'], 's': ['s'], 'z': ['z'], 'ʃ': ['S'], 'ʒ': ['Z'], 'h': ['h'],
    'm': ['m'], 'n': ['n'], 'ŋ': ['N'], 'l': ['l'], 'r': ['R'], 'w': ['u'], 'j': ['j'],
    'iː': ['i:'], 'ɪ': ['I'], 'e': ['E'], 'æ': ['a'], 'ʌ': ['a'], 'ɑː': ['a:'], 'ɒ': ['O'], 'ɔː': ['o:'],
    'ʊ': ['U'], 'uː': ['u:'], 'ɜː': ['9'], 'ə': ['@'], 'i': ['i'], 'eɪ': ['e:', 'I'], 'aɪ': ['a', 'I'],
    'ɔɪ': ['O', 'Y'], 'əʊ': ['@', 'U'], 'aʊ': ['a', 'U'], 'ɪə': ['I', '@'], 'eə': ['E', '@'], 'ʊə': ['U', '@'],
    '_': [''],
}


# TGSpeechBox reads eSpeak-style IPA
TGSB = {'r': 'ɹ', 'tʃ': 't͡ʃ', 'dʒ': 'd͡ʒ', 'g': 'ɡ', 'e': 'ɛ'}


def pitch_at(pitch, t):
    if t <= pitch[0]['time']:
        return pitch[0]['hz']
    for a, b in zip(pitch, pitch[1:]):
        if a['time'] <= t <= b['time']:
            u = (t - a['time']) / max(1e-9, b['time'] - a['time'])
            return a['hz'] + (b['hz'] - a['hz']) * u
    return pitch[-1]['hz']


def write_wav(path, samples, sr):
    peak = max(1e-9, max(abs(x) for x in samples))
    g = 0.89 / peak
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in samples))


# ---------------------------------------------------------------- engines
def render_mbrola(plan, out):
    lines = []
    for s in plan['segments']:
        ms = max(10, round(s['duration'] * 1000))
        pts = []
        for k in (0.1, 0.5, 0.9):  # three pitch targets per segment follow the plan's contour
            pts += [str(round(k * 100)), str(round(pitch_at(plan['pitch'], s['start'] + k * s['duration'])))]
        lines.append(f"{MBROLA[s['phone']]} {ms} {' '.join(pts) if s['phone'] != '_' else ''}".strip())
    with tempfile.NamedTemporaryFile('w', suffix='.pho', delete=False) as f:
        f.write('\n'.join(lines) + '\n')
    subprocess.run([os.environ['MBROLA_BIN'], '-e', os.environ['MBROLA_VOICE'], f.name, out], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.unlink(f.name)


_vtl = None


def render_vtl(plan, out):
    global _vtl
    if _vtl is None:
        _vtl = ctypes.cdll.LoadLibrary(os.environ['VTL_LIB'])
        if _vtl.vtlInitialize(os.environ['VTL_SPEAKER'].encode()) != 0:
            raise RuntimeError('vtlInitialize failed')
    tmp = tempfile.mkdtemp()
    seg, ges = os.path.join(tmp, 'p.seg'), os.path.join(tmp, 'p.ges')
    rows = []
    for s in plan['segments']:
        parts = VTL[s['phone']]
        share = [0.55, 0.45] if len(parts) == 2 else [1.0]
        rows += [f"name = {p}; duration_s = {s['duration'] * w:.6f};" for p, w in zip(parts, share)]
    open(seg, 'w').write('\n'.join(rows) + '\n')
    if _vtl.vtlSegmentSequenceToGesturalScore(seg.encode(), ges.encode(), False) != 0:
        raise RuntimeError('segment conversion failed')
    # replace VTL's standard f0 tier with the plan's contour (targets every 50 ms, semitones re 1 Hz)
    total = plan['duration']
    steps, t, g = [], 0.0, []
    while t < total - 1e-6:
        d = 0.05 if total - t >= 0.07 else total - t  # no sliver at the end (VTL rejects very short gestures)
        hz = pitch_at(plan['pitch'], t + d)
        g.append(f'    <gesture value="{12 * math.log2(hz):.4f}" slope="0.000000" duration_s="{d:.6f}" time_constant_s="0.020000" neutral="0" />')
        t += d
    text = open(ges).read()
    text = re.sub(r'(<gesture_sequence type="f0-gestures" unit="st">)(.*?)(</gesture_sequence>)',
                  lambda m: m.group(1) + '\n' + '\n'.join(g) + '\n  ' + m.group(3), text, flags=re.S)
    open(ges, 'w').write(text)
    n = ctypes.c_int(0)
    buf = (ctypes.c_double * int((total + 1) * 44100))()
    if _vtl.vtlGesturalScoreToAudio(ges.encode(), b'', buf, ctypes.byref(n), False) != 0:
        raise RuntimeError('synthesis failed')
    write_wav(out, buf[:n.value], 44100)


def render_tgsb(plan, out):
    # IPA from the plan's phones (same pronunciation), stress mark before each stressed syllable,
    # commas at phrase pauses; TGSB then applies its own timing and Fujisaki pitch.
    parts, word, syl_start, prev_role = [], None, 0, None
    cur = []
    for s in plan['segments']:
        if s['phone'] == '_':
            if cur:
                parts.append(''.join(cur)); cur = []
            if parts and s['start'] > 0.2 and s['duration'] > 0.1 and parts[-1] not in (',',):
                parts.append(',')
            word, prev_role = None, None
            continue
        if s['word'] != word:
            if cur:
                parts.append(''.join(cur))
            cur, word, prev_role = [], s['word'], None
        if s['role'] == 'onset' and prev_role in (None, 'nucleus', 'coda'):
            syl_start = len(cur)
        if s['role'] == 'nucleus' and prev_role in ('nucleus', 'coda'):
            syl_start = len(cur)
        if s['role'] == 'nucleus' and s['stress'] == 1:
            cur.insert(syl_start, 'ˈ')
        cur.append(TGSB.get(s['phone'], s['phone']))
        prev_role = s['role']
    if cur:
        parts.append(''.join(cur))
    while parts and parts[-1] == ',':
        parts.pop()
    text = ' '.join(parts).replace(' ,', ',') + ('?' if plan['text'].strip().endswith('?') else '.')
    d = os.environ['TGSB_DIR']
    raw = subprocess.run([os.path.join(d, 'build', 'tgsbRender'), '--packdir', d, '--lang', 'en-gb', '--samplerate', '16000',
                          '--rate', os.environ.get('TGSB_RATE', '-30')],
                         input=text.encode(), capture_output=True, check=True).stdout
    samples = [x / 32768 for x in struct.unpack(f'<{len(raw) // 2}h', raw)]
    write_wav(out, samples, 16000)


ENGINES = {'mbrola': render_mbrola, 'vtl': render_vtl, 'tgsb': render_tgsb}

if __name__ == '__main__':
    engine, plans, outdir = sys.argv[1:4]
    os.makedirs(outdir, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(plans, '*.json'))):
        plan = json.load(open(f))
        ENGINES[engine](plan, os.path.join(outdir, plan['id'] + '.wav'))
    print(f'{engine}: rendered {len(glob.glob(os.path.join(outdir, "*.wav")))} files to {outdir}')

"""
Auxiliary intelligibility check: transcribe benchmark clips with Whisper through sherpa-onnx,
offline. Development tool only; not a project dependency and not ground truth.

    pip install sherpa-onnx numpy
    # models (Apache-2.0 code, MIT weights): sherpa-onnx's GitHub release "asr-models"
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2
    # optional, recognisers with little or no language model (closer to the acoustics):
    #   sherpa-onnx-nemo-ctc-en-citrinet-512 (CTC), sherpa-onnx-zipformer-en-2023-06-26 (transducer)
    python3 scripts/speech/asr_whisper.py <benchmarkDir> <modelDir> [<modelDir> ...]

Writes <benchmarkDir>/asr.json for base.en (the M1 setting) and asr.<name>.json for any other
model (e.g. asr.small.json); re-run scripts/speech/benchmark.ts to score them. Two recognisers
of different size disagree in useful ways: the larger one leans harder on its language model.
"""
import glob, json, os, sys, wave
import numpy as np
import sherpa_onnx


def resample16k(x, sr):
    """Windowed-sinc resampling to 16 kHz (keeps sherpa-onnx from resampling and logging per clip)."""
    if sr == 16000:
        return x
    ratio = 16000 / sr
    n_out = int(round(len(x) * ratio))
    t = np.arange(n_out) / ratio
    half = 16
    cutoff = min(1.0, ratio)
    out = np.zeros(n_out, dtype=np.float64)
    base = np.floor(t).astype(int)
    span = int(half / cutoff)
    for k in range(-span, span + 1):
        j = base + k
        valid = (j >= 0) & (j < len(x))
        d = (j - t) * cutoff
        w = 0.5 + 0.5 * np.cos(np.pi * (j - t) / (half / cutoff))
        out[valid] += x[j[valid]] * np.sinc(d[valid]) * w[valid] * cutoff
    return out.astype(np.float32)


def recogniser(model):
    tokens = os.path.join(model, 'tokens.txt')
    if 'nemo-ctc' in model:  # CTC, no language model: closest to "what the audio says"
        return 'citrinet', sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=os.path.join(model, 'model.int8.onnx'), tokens=tokens, num_threads=4)
    if 'zipformer' in model:  # transducer with only its small internal prediction network
        f = lambda part: glob.glob(os.path.join(model, f'{part}-*.int8.onnx'))[0]
        return 'zipformer', sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=f('encoder'), decoder=f('decoder'), joiner=f('joiner'), tokens=tokens, num_threads=4)
    enc = glob.glob(os.path.join(model, '*-encoder.int8.onnx'))[0]
    name = os.path.basename(enc).split('-encoder')[0]  # e.g. base.en
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=enc, decoder=enc.replace('encoder', 'decoder'),
        tokens=os.path.join(model, f'{name}-tokens.txt'),
        language='en', task='transcribe', num_threads=4)
    return name.split('.')[0], rec


out_dir = sys.argv[1]
for model in sys.argv[2:]:
    short, rec = recogniser(model)
    results = {}
    for voice in sorted(os.listdir(out_dir)):
        vdir = os.path.join(out_dir, voice)
        if not os.path.isdir(vdir):
            continue
        for name in sorted(os.listdir(vdir)):
            if not name.endswith('.wav'):
                continue
            with wave.open(os.path.join(vdir, name)) as w:
                sr = w.getframerate()
                x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
            s = rec.create_stream()
            s.accept_waveform(16000, resample16k(x, sr))
            rec.decode_stream(s)
            results[f'{voice}/{name}'] = s.result.text.strip().lower().capitalize()
    path = os.path.join(out_dir, 'asr.json' if short == 'base' else f'asr.{short}.json')
    with open(path, 'w') as f:
        json.dump(results, f, indent=1)
    print(f'{short}: {len(results)} clips -> {path}', flush=True)

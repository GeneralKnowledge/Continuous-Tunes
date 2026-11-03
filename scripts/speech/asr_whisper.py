"""
Auxiliary intelligibility check: transcribe benchmark clips with Whisper (base.en) through
sherpa-onnx, offline. Development tool only; not a project dependency and not ground truth.

    pip install sherpa-onnx numpy
    # model (Apache-2.0 code, MIT weights): sherpa-onnx's GitHub release "asr-models"
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2
    tar xjf sherpa-onnx-whisper-base.en.tar.bz2
    python3 scripts/speech/asr_whisper.py <benchmarkDir> <modelDir>

Writes <benchmarkDir>/asr.json; re-run scripts/speech/benchmark.ts to score it.
"""
import json, os, sys, wave
import numpy as np
import sherpa_onnx

out_dir, model = sys.argv[1], sys.argv[2]
rec = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=os.path.join(model, 'base.en-encoder.int8.onnx'),
    decoder=os.path.join(model, 'base.en-decoder.int8.onnx'),
    tokens=os.path.join(model, 'base.en-tokens.txt'),
    language='en', task='transcribe', num_threads=4)
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
        s.accept_waveform(sr, x)
        rec.decode_stream(s)
        results[f'{voice}/{name}'] = s.result.text.strip()
        print(f'{voice}/{name}: {results[f"{voice}/{name}"]}', flush=True)
with open(os.path.join(out_dir, 'asr.json'), 'w') as f:
    json.dump(results, f, indent=1)

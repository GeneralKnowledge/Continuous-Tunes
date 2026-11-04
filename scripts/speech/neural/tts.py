"""
Render sentences with an offline neural TTS through sherpa-onnx (Kokoro or Piper VITS models from
the sherpa-onnx "tts-models" GitHub release), for the Strudel voice: the audio is what the pasted
Strudel code will play. Development tool.

    python3 scripts/speech/neural/tts.py <model dir> <out dir> <plans dir|items.json> [--sid 0] [--speed 1] [--threads 1]

Writes <out dir>/<id>.wav (mono, the model's rate).
"""
import glob, json, os, sys
import numpy as np
import sherpa_onnx
import soundfile as sf


def opt(args, k, d):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d


def main():
    args = sys.argv[1:]
    sid = int(opt(args, '--sid', '0')); speed = float(opt(args, '--speed', '1')); threads = int(opt(args, '--threads', '1'))
    mdir, out, src = args
    if os.path.isdir(src):
        items = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(src, '*.json')))]
    else:
        items = json.load(open(src))
    if os.path.exists(os.path.join(mdir, 'voices.bin')):
        onnx = [f for f in glob.glob(f'{mdir}/*.onnx')][0]
        lex = f'{mdir}/lexicon-gb-en.txt'
        model = sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=onnx, voices=f'{mdir}/voices.bin', tokens=f'{mdir}/tokens.txt', data_dir=f'{mdir}/espeak-ng-data',
            lexicon=lex if os.path.exists(lex) else '', lang='en-gb' if os.path.exists(lex) else ''), num_threads=threads)
    else:
        onnx = [f for f in glob.glob(f'{mdir}/*.onnx')][0]
        model = sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=onnx, tokens=f'{mdir}/tokens.txt', data_dir=f'{mdir}/espeak-ng-data'), num_threads=threads)
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model))
    os.makedirs(out, exist_ok=True)
    for it in items:
        a = tts.generate(it['text'], sid=sid, speed=speed)
        sf.write(os.path.join(out, it['id'] + '.wav'), np.array(a.samples, dtype=np.float32), a.sample_rate, subtype='PCM_16')
    print(f'{len(items)} rendered -> {out}')


if __name__ == '__main__':
    main()

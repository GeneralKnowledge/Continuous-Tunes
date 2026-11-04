# Neural voice played by Strudel

Reuben relaxed the rules on 4 November 2026: "We can do anything to generate a better voice; the only
restriction is Strudel has to play it at the end." So the Speech tab now has a third Strudel
button, **Copy Strudel neural voice**. It renders the text with a neural British voice in the
browser and emits a Strudel program that carries that speech as compressed audio. Strudel decodes
the audio and plays it as a registered sound, so it goes through Strudel's scheduler and effects
chain like any other sound (`.gain()`, `.room()`, `.speed()` …).

## Results

These are scores on the 114-sentence benchmark, using the same texts as every other engine, scored
by Whisper (the judge Reuben chose). The first two rows were recorded from real Strudel
(`@strudel/web` 1.3, the same engine as strudel.cc). The last row is the app's own path (our front
end and tokeniser) rendered in Node; it does better than sherpa-onnx's because our normaliser
reads numbers, money and abbreviations.

| Voice | Whisper small WER | Whisper base WER | Diagnostic words heard |
|---|---|---|---|
| Strudel formant voice V1 (fitted prosody) | 15% | 18% | 47% |
| Kokoro bm_george through sherpa-onnx, played by Strudel | **8%** | 12% | 83% |
| Kokoro bm_george through the app's own path (below) | **4%** | **7%** | **85%** |

End to end, the button was clicked in headless Chromium against `vite preview` and produced
56 KB of code for two sentences in 25 s on first use, including the model download. That code was
then played in real Strudel. Whisper small transcribed it word for word, "zoo" included.

## How it works

1. **Front end.** Our own front end (`analyzeText`) handles text normalisation, sentence types and
   phrase boundaries.
2. **Phonemes** (`src/speech/neural/kokoro-text.ts`).
   - Each word is looked up in Kokoro's British lexicon, which uses misaki notation (191,924 words).
   - Words it lacks take our own pronunciation, mapped to misaki symbols.
   - Phrase boundaries become `,` `;`, and sentence ends become `.` `?` `!`.
   - eSpeak is not used.
3. **Network** (`src/speech/neural/kokoro.ts`).
   - Kokoro v1.0 (82M parameters, int8 ONNX) runs in onnxruntime-web: WebAssembly, one thread.
   - It takes one call per sentence and returns 24 kHz audio.
   - The speaker is bm_george, a British male voice. Its 510 × 256 style table is the only
     part of `voices.bin` the app ships.
4. **Encoding.** Audio is encoded as 48 kbps mono MP3 in the page, using lamejs
   (`src/speech/neural/mp3.ts`). That is about 11 KB of base64 per second of speech.
5. **Strudel program** (`src/speech/strudel/recorded.ts`). The program decodes the audio with
   `decodeAudioData`, registers it as `ctvoice` and plays `s("ctvoice")`, one cycle per utterance.
   The rate slider sets Kokoro's speed. The pitch slider and the voice presets apply only to the
   formant voices.

## Assets and deployment

- `scripts/speech/neural/fetch-kokoro.sh` puts `public/models/kokoro/` in place. It is not in
  git; the Dockerfile runs the script.
  - Source: the sherpa-onnx `tts-models` GitHub release.
  - Contents: `model.int8.onnx` (114 MB), `voice.bin` (522 KB), `tokens.txt` and
    `lexicon-gb-en.txt` (6.4 MB).
- Vite bundles onnxruntime-web's WebAssembly runtime as an asset of 29 MB.
- Everything loads on the first click only. The Music tab and the formant voices are untouched.

## Licences

| Part | Licence |
|---|---|
| Kokoro v1.0 weights and voices | Apache 2.0 |
| sherpa-onnx export, tokens, lexicon (misaki dictionaries) | Apache 2.0 |
| onnxruntime-web | MIT |
| lamejs (`@breezystack/lamejs`) | LGPL 3.0, compatible with the app's AGPL |

## Development tools

```
scripts/speech/neural/fetch-kokoro.sh                                       # assets
npx tsx scripts/speech/neural/render.ts <outDir> <items.json>              # the app's path, in Node
python3 scripts/speech/neural/tts.py <modelDir> <outDir> <plans|items>     # sherpa-onnx reference (Kokoro or Piper)
npx tsx scripts/speech/neural/compile.ts <wavDir> <items.json> <out.json>  # WAVs → Strudel programs (ffmpeg MP3)
node scripts/speech/strudel-render.mjs <out.json> <dir> 2                   # play them in real Strudel
```

## What next

- **Musical control.** The formant voice can follow any pitch track. The neural voice is a fixed
  recording, which Strudel can only retime and transpose as a whole (`.speed()`). The vocoder
  (option A of the plan) can re-pitch it frame by frame: analyse the neural audio, then
  resynthesise it in Strudel at musical pitches. Its analysis script and worklet are drafted in
  `scripts/speech/vocoder/` and `src/speech/strudel/instrument/vocoder-processor.ts`.
- **Code size.** About 11 KB per second at 48 kbps. Opus would halve it, but Safari cannot decode
  Ogg Opus everywhere.

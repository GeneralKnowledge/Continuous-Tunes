# Speech synthesis: research assessment

What we can borrow for Continuous Speech, what we build ourselves, and what stays a reference.
Checked November 2026. Licences were read from each project's own licence file or package metadata;
where that was not possible it is marked *unverified*.

## Summary

| Project / resource | Use in Continuous-Tunes | Licence | Maintained? |
|---|---|---|---|
| **Britfone** (British pronunciation dictionary) | **Dependency** (npm `britfone`): primary lexicon | MIT (Jose Llarena, 2017) | Static since 2017 (v3.0.1); fine for a lexicon |
| **CMU Pronouncing Dictionary** | **Dependency** (npm `cmu-pronouncing-dictionary`): secondary lexicon, converted to British | BSD-2-Clause style (CMU); npm wrapper ISC | cmudict: occasional updates; wrapper v3.0.0 (2022) |
| Klatt cascade/parallel synthesiser (papers) | **Implemented natively** (`backends/formant/klatt.ts`) | Algorithms from published papers | n/a |
| Klatt duration rules (1979; MITalk 1987) | **Implemented natively** (`prosody.ts`) | Published algorithm | n/a |
| NRL letter-to-sound rules (Elovitz et al. 1976) | **Approach borrowed**, our own smaller British rule set (`g2p.ts`) | US Government work, public domain | n/a |
| eSpeak NG | Reference only | GPL-3.0-or-later | Active |
| MBROLA engine | Reference only (M2 design) | AGPL-3.0 (engine, since 2018) | Low activity |
| MBROLA voices (e.g. en1, British male) | **Not usable** | Non-commercial, non-military, no redistribution without permission | — |
| Flite | Reference (architecture, LTS trees, lexicon compression) | CMU BSD-style permissive | Sporadic (2.2, 2020) |
| Festvox / Festival | Reference; diphone prompt design for our own corpus (M2) | X11-style permissive | Low activity |
| OpenPhonemizer | Reference only | BSD-3-Clause-Clear (code); neural weights | **Unmaintained** (author says so), alpha |
| Praat | External analysis tool during development | GPL-3 | Active |
| librosa | Reference for algorithms (YIN/pYIN, resampling) | ISC | Active |
| PSOLA / TD-PSOLA | To implement natively in M2 | Algorithm (Moulines & Charpentier 1990); the original patent (France Télécom) has expired | n/a |
| CMU ARCTIC | Candidate for M2 bootstrapping and evaluation | Permissive, free use with attribution (CMU) | Static |
| VCTK | Candidate British evaluation set | CC BY 4.0 | Static |
| Mozilla Common Voice | Not suitable for diphones; possible ASR-side evaluation | CC0 | Active |
| Whisper (via sherpa-onnx) | **Dev-only** auxiliary intelligibility check, never shipped | Whisper weights MIT; sherpa-onnx Apache-2.0 | Active |

## Per project

### eSpeak NG
Offers a complete rule-based TTS: per-language pronunciation rules and exception lists (`en_rules`,
`en_list`), a phoneme definition language with formant targets per phoneme, intonation "tunes",
a Klatt synthesiser (from Jon Iles and Nick Ing-Simmons' implementation) and an MBROLA front end.
It is the best working example of a formant TTS front end, and its British (`en-GB-x-rp`) rules
are the most complete free British G2P. But it is GPL-3: copying its rules, phoneme tables or C
code into our sources would make the speech module GPL. We read it for ideas (how it splits
stops into closure/burst/aspiration, how it handles weak forms) and copy nothing.

### MBROLA
The engine is AGPL-3 since 2018 and does one thing: concatenate diphones from a database with
PSOLA-style pitch and duration control, driven by a `.pho` file (phone, duration, pitch targets).
That `.pho` shape is close to our `SpeechPlan`, which confirms the representation. The voices
are the problem: the licence forbids commercial and military use and redistribution without
permission, so we cannot ship `en1` (British) or use it to build ours. MBROLA's MBR-PSOLA paper
(Dutoit & Leich 1993) is the useful part for M2.

### Klatt synthesis
Klatt 1980 ("Software for a cascade/parallel formant synthesizer", JASA 67) and Klatt & Klatt
1990 (KLGLOTT88 voicing source) describe everything we need: two-pole resonators, the cascade
branch for voicing and aspiration, the parallel branch for frication, the nasal pole/zero pair,
and a 5 ms parameter frame. We implemented it from the papers in TypeScript (~300 lines), so
there is no licence question and every parameter is ours to evolve.

### Flite and Festvox
Flite (BSD-style) is the lightweight C version of Festival: an utterance made of relations
(words, syllables, segments), CART-based letter-to-sound trained on CMUdict, compressed
lexicons, and unit-selection/diphone voices. Its relation-based utterance shaped ours. Its LTS
trees are US English and large; we chose a small rule set for M1 and may train our own British
CART later from Britfone. Festvox documents how to build a diphone voice (nonsense-word carrier
prompts covering every diphone, labelling, pitchmarking), which is the plan for M2.

### CMU Pronouncing Dictionary and cmu-pronouncing-dictionary
134,000 words in ARPAbet with stress, General American. The npm wrapper is a plain object, easy
to lazy-load. We convert to Southern British in `cmuToBritish`: non-rhotic r and centring
diphthongs (NEAR, SQUARE, CURE), LOT vs PALM and THOUGHT vs CLOTH by spelling, a narrow BATH rule,
GOAT as /əʊ/, yod after t/d/n. These are heuristics; Britfone covers the common words where most
exceptions live.

### British pronunciation resources
- **Britfone** (MIT): 16,000 SSB words in IPA with primary and secondary stress and alternatives
  (weak and strong forms). Adopted as the primary lexicon.
- **Unisyn** (CSTR, Edinburgh): accent-independent lexicon that can generate RP. Licence requires
  registration and restricts redistribution (*unverified in detail*): not used.
- **eSpeak NG en-GB rules**: GPL-3, reference only (above).
- **Longman/Cambridge/Oxford dictionaries**: proprietary.

### OpenPhonemizer
A DeepPhonemizer model trained to imitate eSpeak's output, published so non-GPL software can get
eSpeak-like phonemes. Code BSD-3-Clause-Clear, but it needs PyTorch and a ~100 MB checkpoint, is
US-leaning and the author has marked it unmaintained. Against the "no large pretrained model"
constraint. Useful only as an offline comparison for our G2P.

### Praat, PSOLA, librosa
Praat (GPL-3) is the standard tool to inspect our output (pitch, formants, intensity) and is used
outside the repo. TD-PSOLA is a short algorithm (pitch marks, windowed periods, overlap-add at
new spacing) that we will implement natively for M2. librosa (ISC) is a reference for pitch
tracking and resampling; our `metrics.ts` and `audio.ts` carry small TypeScript versions.

## Speech data: what is actually usable

A diphone database needs every phone-to-phone transition (≈1,600–2,000 for English), each
recorded cleanly, in a monotone, at a steady rate, and labelled to the phone boundary with pitch
marks. Ordinary read-speech corpora do not give that directly.

| Dataset | Accent | Licence | For diphones | For evaluation |
|---|---|---|---|---|
| MBROLA voices | various, en1 British | non-commercial, no redistribution | No (licence) | No |
| CMU ARCTIC | US (plus Scottish `awb`, Canadian, Indian) | permissive (CMU) | Possible: phonetically balanced, ~1,100 utterances per speaker, with labels, but natural prosody and US accent | Yes (reference recordings) |
| VCTK | 110 British-Isles speakers | CC BY 4.0 | Weak: ~400 sentences per speaker, no labels (needs forced alignment) | Yes: British reference speech |
| Common Voice | crowd, mixed | CC0 | No: varied microphones, noise, no labels | Limited (accent variety) |
| LJ Speech | US female | public domain | Weak (single read speaker, needs alignment) | Yes |

**Recommendation for M2:** record our own small diphone set (one speaker, Festvox-style nonsense
words in a carrier, ~1,800 diphones, about two hours of recording), which is the only route that
is legally clean, British and designed for concatenation. Bootstrap the pipeline meanwhile with
units cut from CMU ARCTIC `awb` or VCTK using forced alignment, clearly marked as non-British or
non-redistributable where the licence requires attribution.

## Dependencies added

- `britfone` (data, MIT) and `cmu-pronouncing-dictionary` (data, BSD + ISC wrapper). Both are
  dynamic imports, so they load the first time the Speech tab opens and never affect music.
  Their licences ship in `public/licenses/speech-data.txt`.
- No runtime speech dependency besides those. Whisper/sherpa-onnx are optional local tools for
  the benchmark only.

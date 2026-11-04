#!/bin/sh
# Fetch the Kokoro neural voice (Apache 2.0) for the Speech tab's neural Strudel voice into
# public/models/kokoro/: the int8 network, one speaker's style table, tokens and the British
# lexicon, from the sherpa-onnx "tts-models" GitHub release. Run before `npm run build`; the
# Dockerfile runs it too. Usage: scripts/speech/neural/fetch-kokoro.sh [speaker id, default 26 = bm_george]
set -e
SID=${1:-26}
DIR=$(dirname "$0")/../../../public/models/kokoro
NAME=kokoro-int8-multi-lang-v1_0
mkdir -p "$DIR"
TMP=$(mktemp -d)
curl -fsSL -o "$TMP/k.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$NAME.tar.bz2"
tar -xjf "$TMP/k.tar.bz2" -C "$TMP" "$NAME/model.int8.onnx" "$NAME/voices.bin" "$NAME/tokens.txt" "$NAME/lexicon-gb-en.txt" "$NAME/LICENSE"
cp "$TMP/$NAME/model.int8.onnx" "$TMP/$NAME/tokens.txt" "$TMP/$NAME/lexicon-gb-en.txt" "$TMP/$NAME/LICENSE" "$DIR/"
# one speaker's style table: 510 x 256 float32 = 522240 bytes at offset SID * 522240
dd if="$TMP/$NAME/voices.bin" of="$DIR/voice.bin" bs=522240 skip="$SID" count=1 2>/dev/null
rm -rf "$TMP"
ls -la "$DIR"

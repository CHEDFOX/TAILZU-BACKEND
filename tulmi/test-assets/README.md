# test-assets

Put a sample audio clip here (e.g. `sample.m4a`, `sample.wav`) to run the
pipeline test:

```bash
npm run test:pipeline -- ./test-assets/sample.m4a --app WhatsApp --lang auto
```

Record ~10–20 seconds of natural speech — for the Hinglish handling, try a
clip that mixes Hindi and English with some fillers ("um", "matlab", "like").

Audio files here are git-ignored except this README.

## Comparing the two speech engines

```bash
npm run bench:stt -- ./test-assets                       # every engine, 3 runs each
npm run bench:stt -- ./test-assets --engines sarvam,deepgram
npm run bench:stt -- ./test-assets --flow                # + the writing step
```

The keyboard mic and the in-app mic take different roads — the keyboard streams
to `STT_LIVE_PROVIDER`, the app posts a clip to `STT_PROVIDER` — so the same
sentence can come back better from one than the other. This gives both engines
the same audio and reports median latency, the script each came back in, and,
when a reference exists, how wrong each one was.

Put the reference next to the clip:

```
test-assets/hindi-01.m4a
test-assets/hindi-01.txt      ← what was actually said, exactly
```

Read CER rather than WER for Indic clips. Devanagari packs a clause into few
space-separated tokens, so two wrong characters can fail most of the "words"
and make a good transcript look catastrophic.

Each run writes `bench-<timestamp>.json`, so a config change can be measured
against the run before it rather than against memory.

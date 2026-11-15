# Sounds

All recordings come from the **VS Chamber Orchestra: Community Edition (VSCO 2 CE)** sample library
by Sam Gossner & Simon Dalzell, released under **CC0 1.0** (public domain):
https://github.com/sgossner/VSCO-2-CE

| File | Source sample | Used for |
|---|---|---|
| `tick-wood-1.wav`, `tick-wood-2.wav` | `Percussion/Claves1_Hit_v1_rr1/rr2_Sum.wav` | "Wooden click" tick (alternated) |
| `tick-sleigh.wav` | `Miscellania Raw/Misc 2/sleighbell1_hit_1.wav` | "Sleigh bells" tick |
| `sleigh-shake.wav` | `Miscellania Raw/Misc 2/sleighbell1_shake1.wav` | Under the Christmas win tune |
| `glock-g5.wav` | `Percussion/Glock/glock_medium_G4.wav` | Glockenspiel, sounds G5 (MIDI 79) |
| `glock-c6.wav` | `Percussion/Glock/glock_medium_C5.wav` | Glockenspiel, sounds C6 (MIDI 84) |
| `glock-g6.wav` | `Percussion/Glock/glock_medium_G5.wav` | Glockenspiel, sounds G6 (MIDI 91) |

The glockenspiel files sound one octave above their names; pitches above were measured. Other
notes (music-box tick, win tunes) are made by re-pitching the nearest glockenspiel sample in
`js/effects.js`.

## How they were made

Each sample was trimmed, faded out, mixed to mono, loudness-normalized, and resampled to 24 kHz
16-bit WAV (WAV plays everywhere and has no start-up delay, which matters for ticks):

```sh
# name | source | start s | length s | fade-out s | extra filter
ffmpeg -i SOURCE.wav -af "atrim=start=START,asetpts=PTS-STARTPTS,atrim=0:LENGTH[,EXTRA],\
afade=t=in:d=0.002,afade=t=out:st=LENGTH-FADE:d=FADE,pan=mono|c0=0.5*c0+0.5*c1,\
loudnorm=I=-20:TP=-2:LRA=11,aresample=24000" -ac 1 -c:a pcm_s16le OUT.wav
```

| Output | start | length | fade | extra |
|---|---|---|---|---|
| tick-wood-1 / -2 | 0 | 0.18 | 0.12 | `lowpass=f=3500` (softer click) |
| tick-sleigh | 0.02 | 0.45 | 0.3 | |
| sleigh-shake | 0 | 2.4 | 1.0 | |
| glock-g5, glock-c6 | 0.004 | 2.2 | 1.4 | |
| glock-g6 | 0.004 | 2.0 | 1.3 | |

To swap a sound, replace the file (keep the name) or change `SOUND_FILES` in `js/effects.js`.

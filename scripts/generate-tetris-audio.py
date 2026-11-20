#!/usr/bin/env python3
"""Generate the tetris sound effects (assets/sfx/) and music (assets/music/).

Original chiptune-style audio (pulse, triangle and noise voices, like an 8-bit
console's sound chip). Standard library only, deterministic output:

    python3 scripts/generate-tetris-audio.py
"""

import os

from chiptune import (
    MUSIC_DIR,
    OUT_DIR,
    RATE,
    Noise,
    mix,
    noise,
    note,
    parse_line,
    seq,
    tone,
    triangle,
    voice_pulse,
    write,
)

MUSIC_RATE = 22050  # half rate keeps the looping track small


# === Music ===
# An original loop in A minor, 16 bars of 4/4 at 150 BPM, written as eighth
# notes. "." holds the previous note, "-" is a rest.
MUSIC_BPM = 150
LEAD = [
    # A section
    "A4 . C5 E5 A5 . G5 E5",
    "G#5 . E5 B4 G#4 . B4 E5",
    "A5 . E5 C5 D5 C5 B4 A4",
    "B4 . G#4 E4 B4 . . -",
    "D5 . F5 A5 F5 . D5 F5",
    "E5 . C5 A4 C5 . E5 A5",
    "G#5 F5 E5 D5 B4 . G#4 B4",
    "A4 . . . E4 . A4 -",
    # B section
    "C6 . A5 F5 C5 . F5 A5",
    "G5 . E5 C5 G4 . C5 E5",
    "D5 . B4 G4 D5 E5 F5 G5",
    "E5 . G5 C6 . . G5 E5",
    "F5 E5 D5 F5 A5 . F5 D5",
    "E5 D5 C5 E5 A5 . E5 C5",
    "B4 C5 D5 E5 G#5 . B5 G#5",
    "A5 . . . - . E5 -",
]
BASS_ROOTS = ["A", "E", "A", "E", "D", "A", "E", "A", "F", "C", "G", "C", "D", "A", "E", "A"]


def music_theme():
    rate = MUSIC_RATE
    step = 60.0 / MUSIC_BPM / 2.0  # eighth note
    total = int(len(LEAD) * 8 * step * rate)
    out = [0.0] * total

    def add(start_s, samples):
        start = int(start_s * rate)
        for i, v in enumerate(samples):
            j = start + i
            if j < total:
                out[j] += v

    for bar, line in enumerate(LEAD):
        base = bar * 8
        for start, length, f in parse_line(line):
            add((base + start) * step, voice_pulse(f, length * step * 0.92, 0.25, 0.30, rate))

        # Bass: root, octave, root, octave on quarter notes (triangle).
        root = note(BASS_ROOTS[bar] + "2")
        for q in range(4):
            f = root * (2.0 if q % 2 else 1.0)
            add((base + q * 2) * step, triangle(f, step * 1.8, 0.55, rate))

        # Drums: low noise kick on beats 1 and 3, short hi-hat on off-beats.
        gen = Noise()
        for e in range(8):
            t0 = (base + e) * step
            if e % 4 == 0:
                length, clk, vol = 0.07, 2500, 0.30
            elif e % 2 == 1:
                length, clk, vol = 0.025, 20000, 0.12
            else:
                continue
            n = int(length * rate)
            hit = []
            for i in range(n):
                env_v = min(1.0 - i / n, i / (0.001 * rate))
                hit.append(gen.sample(clk * RATE / rate) * env_v * vol)
            add(t0, hit)

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(MUSIC_DIR, exist_ok=True)

    # Looping background theme.
    write("tetris_theme", music_theme(), gain=0.5, out_dir=MUSIC_DIR, rate=MUSIC_RATE, fade_out=False)

    # Sideways move: tiny high click.
    write("tetris_move", tone(1760, 0.025, duty=0.125), gain=0.25)

    # Rotate: two quick rising blips.
    write("tetris_rotate", mix((0, tone(988, 0.03, 0.25)), (0.03, tone(1319, 0.04, 0.25))), gain=0.25)

    # Piece locks: low thud (short noise burst over a falling square).
    write("tetris_lock", mix((0, noise(0.06, 6000, 0.6, 0.3)), (0, tone(196, 0.08, 0.5, 0.8, sweep=-1.0))), gain=0.4)

    # 1-3 lines: rising arpeggio with a noise swish.
    arp = [note(n) for n in ["C5", "E5", "G5", "C6", "E6", "G6"]]
    write("tetris_line", mix((0, seq(arp, 0.04, 0.25)), (0, noise(0.25, 12000, 0.35, 0.2))), gain=0.4)

    # 4 lines: longer two-voice fanfare.
    lead = [note(n) for n in ["C5", "E5", "G5", "C6", "G5", "C6", "E6", "G6", "C7"]]
    bass = [note(n) for n in ["C3", "C3", "G3", "G3", "C4", "C4", "G4", "G4", "C5"]]
    write(
        "tetris_tetris",
        mix(
            (0, seq(lead, 0.055, 0.25, 1.0)),
            (0, seq(bass, 0.055, 0.5, 0.6)),
            (0, noise(0.5, 14000, 0.3, 0.15)),
        ),
        gain=0.45,
    )

    # Level up: quick rising run ending on a held note.
    run = [note(n) for n in ["G4", "A4", "B4", "D5", "E5", "G5"]]
    write(
        "tetris_levelup",
        mix((0, seq(run, 0.045, 0.5, 1.0)), (6 * 0.045, tone(note("G5"), 0.25, 0.25, 1.0, sweep=0.0))),
        gain=0.4,
    )

    # Game over: slow descending phrase with a falling tail.
    fall = [note(n) for n in ["E5", "D#5", "D5", "C#5", "C5", "B4", "A#4", "A4"]]
    write(
        "tetris_gameover",
        mix(
            (0, seq(fall, 0.12, 0.5, 1.0, hold=0.9)),
            (8 * 0.12, tone(note("A4"), 0.6, 0.5, 1.0, sweep=-2.0)),
            (8 * 0.12, noise(0.6, 3000, 0.3, 0.3)),
        ),
        gain=0.4,
    )


if __name__ == "__main__":
    main()

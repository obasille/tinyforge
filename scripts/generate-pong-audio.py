#!/usr/bin/env python3
"""Generate the pong sound effects (assets/sfx/) and music (assets/music/).

Original chiptune-style audio built with the shared synth in chiptune.py
(the same voices as the tetris audio). Standard library only, deterministic
output:

    python3 scripts/generate-pong-audio.py
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
# An original, upbeat loop in G major, 16 bars of 4/4 at 140 BPM, written as
# eighth notes. "." holds the previous note, "-" is a rest.
MUSIC_BPM = 140
LEAD = [
    # A section: G Em C D, twice
    "D5 . B4 D5 G5 . F#5 G5",
    "E5 . . B4 E5 G5 B5 .",
    "A5 G5 E5 C5 E5 . G5 .",
    "F#5 . A5 . D5 . - -",
    "B5 . A5 G5 D5 . G5 B5",
    "G5 . E5 . B4 . E5 G5",
    "E5 F#5 G5 . C6 . B5 A5",
    "A5 . F#5 . D5 . . -",
    # B section: C D Bm Em, C D G G
    "C6 . G5 E5 G5 . C6 E6",
    "D6 . A5 F#5 A5 . D6 F#6",
    "F#6 . D6 B5 F#5 . B5 D6",
    "E6 . . B5 G5 . E5 -",
    "E5 G5 C6 . E5 G5 C6 E6",
    "D6 C6 A5 F#5 D5 . A5 .",
    "B5 . . G5 D5 . B4 D5",
    "G5 . . . - . D5 -",
]
CHORDS = ["G", "Em", "C", "D", "G", "Em", "C", "D", "C", "D", "Bm", "Em", "C", "D", "G", "G"]
CHORD_TONES = {
    "G": ["G", "B", "D"],
    "Em": ["E", "G", "B"],
    "C": ["C", "E", "G"],
    "D": ["D", "F#", "A"],
    "Bm": ["B", "D", "F#"],
}


def chord_arp(name, octave):
    """Chord tones going up then back down: root, third, fifth, octave, fifth, third."""
    tones = CHORD_TONES[name]
    root = note(tones[0] + str(octave))
    up = []
    for t in tones:
        f = note(t + str(octave))
        if f < root:  # keep the chord voiced upward from the root
            f *= 2.0
        up.append(f)
    up.append(root * 2.0)
    return up + up[-2:0:-1]


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

    gen = Noise()
    for bar, line in enumerate(LEAD):
        base = bar * 8
        chord = CHORDS[bar]

        # Lead: 25% pulse.
        for start, length, f in parse_line(line):
            add((base + start) * step, voice_pulse(f, length * step * 0.9, 0.25, 0.28, rate))

        # Arpeggio: quiet, thin 12.5% pulse on sixteenth notes.
        arp = chord_arp(chord, 4)
        for s in range(16):
            f = arp[s % len(arp)]
            add((base + s * 0.5) * step, voice_pulse(f, step * 0.5 * 0.8, 0.125, 0.09, rate))

        # Bass: driving eighth notes on the triangle, root with an octave jump
        # on the off-beats.
        root = note(CHORD_TONES[chord][0] + "2")
        for e in range(8):
            f = root * (2.0 if e % 2 else 1.0)
            add((base + e) * step, triangle(f, step * 0.85, 0.5, rate))

        # Drums: kick on 1 and 3, snare on 2 and 4, hi-hat on every off-beat.
        for e in range(8):
            if e % 4 == 0:
                length, clk, vol = 0.07, 2200, 0.30
            elif e % 4 == 2:
                length, clk, vol = 0.09, 9000, 0.20
            else:
                length, clk, vol = 0.02, 22000, 0.10
            n = int(length * rate)
            hit = []
            for i in range(n):
                env_v = min(1.0 - i / n, i / (0.001 * rate))
                hit.append(gen.sample(clk * RATE / rate) * env_v * vol)
            add((base + e) * step, hit)

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(MUSIC_DIR, exist_ok=True)

    # Looping background theme during play.
    write("pong_theme", music_theme(), gain=0.5, out_dir=MUSIC_DIR, rate=MUSIC_RATE, fade_out=False)

    # Paddle hits: one pitch per player, a short blip with a slight upward bend.
    write("pong_hit_p1", tone(note("B5"), 0.05, duty=0.5, sweep=0.15), gain=0.35)
    write("pong_hit_p2", tone(note("E5"), 0.05, duty=0.5, sweep=0.15), gain=0.35)

    # Side wall bounce: lower, thinner and shorter than a paddle hit.
    write("pong_wall", tone(note("G4"), 0.03, duty=0.125, sweep=-0.2), gain=0.25)

    # Countdown tick for 3, 2, 1, and a higher, longer tone for GO.
    write("pong_tick", tone(note("A5"), 0.08, duty=0.5), gain=0.3)
    write("pong_go", tone(note("A6"), 0.22, duty=0.25), gain=0.3)

    # Serve: the ball launches with a rising swoosh.
    write("pong_serve", mix((0, noise(0.14, 4000, 0.5, 4.0)), (0, tone(note("D5"), 0.12, 0.25, 0.6, sweep=1.0))), gain=0.3)

    # Point scored: quick bright arpeggio over a noise burst.
    arp = [note(n) for n in ["D5", "G5", "B5", "D6"]]
    write("pong_score", mix((0, seq(arp, 0.05, 0.25)), (0, noise(0.18, 8000, 0.4, 0.3))), gain=0.4)

    # Match won: two-voice fanfare ending on a held chord.
    lead = [note(n) if n != "-" else 0 for n in ["G4", "B4", "D5", "G5", "-", "F#5", "G5", "A5"]]
    bass = [note(n) for n in ["G3", "G3", "D4", "D4", "C4", "C4", "D4", "D4"]]
    step = 0.09
    end = 8 * step
    write(
        "pong_win",
        mix(
            (0, seq(lead, step, 0.25, 1.0)),
            (0, seq(bass, step, 0.5, 0.5)),
            (end, tone(note("B5"), 0.6, 0.25, 0.8)),
            (end, tone(note("G5"), 0.6, 0.25, 0.6)),
            (end, tone(note("G3"), 0.6, 0.5, 0.5)),
            (end, noise(0.4, 12000, 0.25, 0.2)),
        ),
        gain=0.45,
    )


if __name__ == "__main__":
    main()

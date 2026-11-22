#!/usr/bin/env python3
"""Generate the Tank Duel sound effects (assets/sfx/) and music (assets/music/).

Original chiptune-style audio built with the shared synth in chiptune.py
(the same voices as the pong and tetris audio). Standard library only,
deterministic output:

    python3 scripts/generate-tank-audio.py
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
# An original marching loop in D minor, 16 bars of 4/4 at 126 BPM, written
# as eighth notes. "." holds the previous note, "-" is a rest.
MUSIC_BPM = 126
LEAD = [
    # A section: Dm Dm Bb C, Dm Dm Gm A
    "D5 . . A4 D5 . F5 .",
    "E5 . D5 . A4 . - .",
    "D5 . F5 . Bb5 . A5 G5",
    "G5 . E5 . C5 . - .",
    "D5 . . A4 D5 . F5 .",
    "A5 . G5 F5 E5 . D5 .",
    "D5 E5 F5 . G5 . Bb5 .",
    "A5 . . . E5 . A4 -",
    # B section: F C Dm A, Bb C Dm Dm
    "F5 . A5 . C6 . A5 .",
    "G5 . E5 . C5 . E5 G5",
    "A5 . F5 . D5 . F5 A5",
    "C#6 . . A5 E5 . - .",
    "D6 . C6 Bb5 F5 . Bb5 .",
    "C6 . Bb5 A5 E5 . G5 .",
    "F5 . E5 . D5 . A4 .",
    "D5 . . . - . A4 -",
]
CHORDS = ["Dm", "Dm", "Bb", "C", "Dm", "Dm", "Gm", "A", "F", "C", "Dm", "A", "Bb", "C", "Dm", "Dm"]
CHORD_TONES = {
    "Dm": ["D", "F", "A"],
    "Gm": ["G", "Bb", "D"],
    "Bb": ["Bb", "D", "F"],
    "C": ["C", "E", "G"],
    "F": ["F", "A", "C"],
    "A": ["A", "C#", "E"],
}


def chord_freqs(name, octave):
    """Chord tones voiced upward from the root."""
    tones = CHORD_TONES[name]
    root = note(tones[0] + str(octave))
    out = []
    for t in tones:
        f = note(t + str(octave))
        if f < root:
            f *= 2.0
        out.append(f)
    return out


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

    def drum(start_s, length, clk, vol):
        n = int(length * rate)
        hit = []
        for i in range(n):
            env_v = min(1.0 - i / n, i / (0.001 * rate))
            hit.append(gen.sample(clk * RATE / rate) * env_v * vol)
        add(start_s, hit)

    for bar, line in enumerate(LEAD):
        base = bar * 8
        chord = CHORDS[bar]

        # Lead: 50% pulse, a rounder, brassier tone than pong's lead.
        for start, length, f in parse_line(line):
            add((base + start) * step, voice_pulse(f, length * step * 0.85, 0.5, 0.22, rate))

        # Off-beat chord stabs on a thin pulse, like a marching band's horns.
        for e in (1, 3, 5, 7):
            for f in chord_freqs(chord, 4):
                add((base + e) * step, voice_pulse(f, step * 0.45, 0.125, 0.06, rate))

        # Bass: root and fifth on the beats (oom-pah), triangle.
        tones = CHORD_TONES[chord]
        root = note(tones[0] + "2")
        fifth = note(tones[2] + "2")
        if fifth < root:
            fifth *= 2.0
        for e in (0, 2, 4, 6):
            f = root if e % 4 == 0 else fifth
            add((base + e) * step, triangle(f, step * 1.6, 0.5, rate))

        # Drums: kick on 1 and 3, snare on 2 and 4, and a snare roll of
        # sixteenths leading into every fourth bar.
        for e in range(8):
            if e % 4 == 0:
                drum((base + e) * step, 0.08, 2000, 0.32)
            elif e % 4 == 2:
                drum((base + e) * step, 0.10, 9000, 0.22)
        if bar % 4 == 3:
            for s in range(8):
                drum((base + 4 + s * 0.5) * step, 0.05, 10000, 0.08 + 0.015 * s)

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(MUSIC_DIR, exist_ok=True)

    # Looping march during a match.
    write("tank_theme", music_theme(), gain=0.5, out_dir=MUSIC_DIR, rate=MUSIC_RATE, fade_out=False)

    # Cannon shot: a noise crack over a falling square thump, pitched per player.
    write("tank_fire_p1", mix((0, noise(0.12, 6000, 0.6, 0.2)), (0, tone(note("A3"), 0.1, 0.5, 0.7, sweep=-1.5))), gain=0.35)
    write("tank_fire_p2", mix((0, noise(0.12, 6000, 0.6, 0.2)), (0, tone(note("D4"), 0.1, 0.5, 0.7, sweep=-1.5))), gain=0.35)

    # Ricochet: a short, thin ping that bends down.
    write("tank_bounce", tone(note("E6"), 0.06, duty=0.125, sweep=-0.7), gain=0.22)

    # Shell burning out (or two shells meeting): soft falling hiss.
    write("tank_fizzle", noise(0.1, 12000, 0.5, 0.1), gain=0.2)

    # Tank destroyed: a long rumbling burst over a deep falling tone.
    write(
        "tank_explode",
        mix(
            (0, noise(0.7, 9000, 1.0, 0.03)),
            (0, tone(note("A2"), 0.5, 0.5, 0.6, sweep=-1.5)),
            (0.05, noise(0.3, 2500, 0.5, 0.3)),
        ),
        gain=0.45,
    )

    # Countdown tick for 3, 2, 1, and a higher, longer tone for GO.
    write("tank_tick", tone(note("D5"), 0.08, duty=0.5), gain=0.3)
    write("tank_go", mix((0, tone(note("D6"), 0.25, 0.25)), (0, tone(note("A5"), 0.25, 0.5, 0.5))), gain=0.3)

    # Match won: a bugle call (D major arpeggio) ending on a held chord.
    lead = [note(n) if n != "-" else 0 for n in ["A4", "A4", "D5", "-", "F#5", "A5", "-", "F#5", "A5"]]
    bass = [note(n) for n in ["D3", "D3", "D3", "D3", "A3", "A3", "A3", "A3", "A3"]]
    step = 0.1
    end = len(lead) * step
    write(
        "tank_win",
        mix(
            (0, seq(lead, step, 0.5, 1.0, hold=0.8)),
            (0, seq(bass, step, 0.5, 0.45, hold=0.9)),
            (end, tone(note("D6"), 0.7, 0.5, 0.7)),
            (end, tone(note("A5"), 0.7, 0.25, 0.5)),
            (end, tone(note("D3"), 0.7, 0.5, 0.5)),
            (end, noise(0.5, 10000, 0.25, 0.2)),
        ),
        gain=0.45,
    )


if __name__ == "__main__":
    main()

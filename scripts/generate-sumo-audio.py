#!/usr/bin/env python3
"""Generate the Sumo Push sound effects (assets/sfx/) and music (assets/music/).

Original chiptune-style audio, built with the shared helpers in chiptune.py.
Standard library only, deterministic output:

    python3 scripts/generate-sumo-audio.py
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
# An original loop on the D minor pentatonic scale (D F G A C), 8 bars of 4/4
# at 132 BPM, written as eighth notes. "." holds the previous note, "-" rests.
# Heavy drum hits on the beat, like a festival drum line.
MUSIC_BPM = 132
LEAD = [
    "D5 . F5 G5 A5 . G5 F5",
    "G5 . A5 C6 A5 . G5 -",
    "F5 . G5 F5 D5 . C5 D5",
    "F5 . . - D5 . . -",
    "A5 . C6 D6 C6 . A5 G5",
    "A5 . G5 F5 G5 . A5 -",
    "D6 C6 A5 G5 F5 G5 A5 C6",
    "D6 . . - A5 . D5 -",
]
BASS = ["D", "D", "F", "D", "A", "F", "G", "D"]
# Per bar, 8 eighth-note drum slots: "B" big drum, "s" small drum, "k" rim click.
DRUMS = [
    "B - k - s - k s",
    "B - k - s k s -",
    "B - k - s - k s",
    "B - B - s s s s",
]


def drum_hit(kind, rate, gen):
    """One drum hit: a pitched thump under a noise burst."""
    if kind == "B":
        length, clk, nvol, f0, tvol = 0.18, 1800, 0.30, 110.0, 0.55
    elif kind == "s":
        length, clk, nvol, f0, tvol = 0.08, 5000, 0.22, 220.0, 0.25
    else:  # rim click
        length, clk, nvol, f0, tvol = 0.02, 22000, 0.12, 0.0, 0.0
    n = int(length * rate)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / rate
        e = min(1.0 - i / n, i / (0.001 * rate)) if i else 0.0
        s = gen.sample(clk * RATE / rate) * nvol
        if f0:
            # Pitch drops quickly, like a struck skin.
            f = f0 * (0.45 + 0.55 * max(0.0, 1.0 - t / length) ** 2)
            phase = (phase + f / rate) % 1.0
            s += (abs(phase * 4.0 - 2.0) - 1.0) * tvol
        out.append(s * e)
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
    for bar, line in enumerate(LEAD):
        base = bar * 8
        for start, length, f in parse_line(line):
            add((base + start) * step, voice_pulse(f, length * step * 0.9, 0.125, 0.26, rate))
            # A quieter echo one eighth later, an octave down, for width.
            add((base + start + 1) * step, voice_pulse(f / 2.0, length * step * 0.6, 0.5, 0.08, rate))

        # Bass: root and fifth, driving eighths (triangle).
        root = note(BASS[bar] + "2")
        for e in range(8):
            f = root * (1.5 if e in (3, 7) else 1.0)
            add((base + e) * step, triangle(f, step * 0.8, 0.45, rate))

        for e, kind in enumerate(DRUMS[bar % len(DRUMS)].split()):
            if kind != "-":
                add((base + e) * step, drum_hit(kind, rate, gen))

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(MUSIC_DIR, exist_ok=True)

    write("sumo_theme", music_theme(), gain=0.5, out_dir=MUSIC_DIR, rate=MUSIC_RATE, fade_out=False)

    # Discs collide: dull low thump plus a short crack.
    write(
        "sumo_bump",
        mix((0, tone(140, 0.09, 0.5, 1.0, sweep=-1.2)), (0, noise(0.05, 9000, 0.5, 0.3))),
        gain=0.45,
    )

    # Dash: fast upward swoosh.
    write("sumo_dash", mix((0, noise(0.16, 3000, 0.6, 6.0)), (0, tone(330, 0.12, 0.25, 0.4, sweep=1.5))), gain=0.35)

    # Ring-out: long falling whistle into a soft landing thud.
    write(
        "sumo_fall",
        mix((0, tone(1200, 0.45, 0.5, 0.7, sweep=-3.0)), (0.42, noise(0.18, 2500, 0.8, 0.3))),
        gain=0.4,
    )

    # Countdown beep and the "go" beep an octave up.
    write("sumo_count", tone(note("A5"), 0.10, 0.5), gain=0.3)
    write("sumo_go", mix((0, tone(note("A6"), 0.22, 0.5)), (0, tone(note("E6"), 0.22, 0.25, 0.5))), gain=0.35)

    # Ring starts shrinking: low wobbling rumble.
    write(
        "sumo_shrink",
        mix(*[(i * 0.08, tone(note(n), 0.08, 0.5, 0.8)) for i, n in enumerate(["D4", "C4", "A3", "G3", "F3", "D3"])])
        + [0.0] * int(0.02 * RATE),
        gain=0.35,
    )

    # Round point: short three-note pentatonic rise.
    write("sumo_point", seq([note(n) for n in ["D5", "G5", "A5"]], 0.07, 0.25), gain=0.35)

    # Match win: drum roll under a pentatonic fanfare.
    fanfare = [note(n) for n in ["D5", "F5", "G5", "A5", "C6", "D6"]]
    write(
        "sumo_win",
        mix(
            (0, seq(fanfare, 0.08, 0.25)),
            (6 * 0.08, tone(note("D6"), 0.5, 0.25, 1.0)),
            (6 * 0.08, tone(note("A5"), 0.5, 0.5, 0.5)),
            (0, noise(0.48, 4000, 0.25, 1.0)),
            (6 * 0.08, noise(0.3, 1800, 0.5, 0.3)),
        ),
        gain=0.45,
    )


if __name__ == "__main__":
    main()

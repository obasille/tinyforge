#!/usr/bin/env python3
"""Generate the tetris sound effects (assets/sfx/) and music (assets/music/).

Original chiptune-style audio (pulse, triangle and noise voices, like an 8-bit
console's sound chip). Standard library only, deterministic output:

    python3 scripts/generate-tetris-audio.py
"""

import os
import struct
import wave

RATE = 44100
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
OUT_DIR = os.path.join(ASSETS, "sfx")
MUSIC_DIR = os.path.join(ASSETS, "music")
MUSIC_RATE = 22050  # half rate keeps the looping track small


class Noise:
    """15-bit LFSR noise, clocked at a given rate (like an NES noise channel)."""

    def __init__(self):
        self.reg = 1
        self.value = 1.0
        self.acc = 0.0

    def sample(self, clock_hz):
        self.acc += clock_hz / RATE
        while self.acc >= 1.0:
            self.acc -= 1.0
            bit = (self.reg ^ (self.reg >> 1)) & 1
            self.reg = (self.reg >> 1) | (bit << 14)
            self.value = 1.0 if self.reg & 1 else -1.0
        return self.value


def env(t, length, attack=0.002):
    """Short attack, linear decay to zero at `length`."""
    if t < attack:
        return t / attack
    return max(0.0, 1.0 - (t - attack) / max(1e-6, length - attack))


def tone(freq, length, duty=0.5, vol=1.0, sweep=0.0):
    """Pulse tone; `sweep` is a pitch change in octaves over its length."""
    out = []
    phase = 0.0
    n = int(length * RATE)
    for i in range(n):
        t = i / RATE
        f = freq * (2.0 ** (sweep * t / length))
        phase = (phase + f / RATE) % 1.0
        s = 1.0 if phase < duty else -1.0
        out.append(s * env(t, length) * vol)
    return out


def noise(length, clock_hz, vol=1.0, clock_sweep=1.0):
    gen = Noise()
    out = []
    n = int(length * RATE)
    for i in range(n):
        t = i / RATE
        clk = clock_hz * (clock_sweep ** (t / length))
        out.append(gen.sample(clk) * env(t, length, 0.001) * vol)
    return out


def mix(*tracks):
    """Mix (offset_seconds, samples) pairs."""
    n = max(int(off * RATE) + len(s) for off, s in tracks)
    out = [0.0] * n
    for off, s in tracks:
        start = int(off * RATE)
        for i, v in enumerate(s):
            out[start + i] += v
    return out


def seq(notes, step, duty=0.5, vol=1.0, hold=1.0):
    """Notes in a row, one every `step` seconds, each lasting step*hold."""
    return mix(*[(i * step, tone(f, step * hold, duty, vol)) for i, f in enumerate(notes) if f])


def note(name):
    names = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    semis = names[name[0]]
    rest = name[1:]
    if rest.startswith("#"):
        semis += 1
        rest = rest[1:]
    elif rest.startswith("b"):
        semis -= 1
        rest = rest[1:]
    octave = int(rest)
    return 440.0 * 2.0 ** ((semis + (octave - 4) * 12) / 12.0)


def write(name, samples, gain=0.35, out_dir=OUT_DIR, rate=RATE, fade_out=True):
    path = os.path.join(out_dir, f"{name}.wav")
    peak = max(1e-6, max(abs(s) for s in samples))
    scale = gain / peak
    # 5 ms fade-out to avoid a click at the end (not for loops).
    fade = int(0.005 * rate)
    data = bytearray()
    for i, s in enumerate(samples):
        k = min(1.0, (len(samples) - i) / fade) if fade_out else 1.0
        data += struct.pack("<h", int(max(-1.0, min(1.0, s * scale * k)) * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(data))
    print(f"wrote {os.path.relpath(path)} ({len(samples) / rate * 1000:.0f} ms)")


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


def parse_line(line):
    """Eighth-note tokens -> list of (start_step, length_steps, freq)."""
    events = []
    for i, tok in enumerate(line.split()):
        if tok == ".":
            if events and events[-1][0] + events[-1][1] == i:
                start, length, f = events[-1]
                events[-1] = (start, length + 1, f)
        elif tok != "-":
            events.append((i, 1, note(tok)))
    return events


def triangle(freq, length, vol, rate):
    out = []
    phase = 0.0
    n = int(length * rate)
    for i in range(n):
        phase = (phase + freq / rate) % 1.0
        # 16-step quantized triangle, like the NES triangle channel.
        tri = abs(phase * 4.0 - 2.0) - 1.0
        tri = round(tri * 7.5) / 7.5
        k = min(1.0, (n - i) / (0.004 * rate), i / (0.002 * rate))  # declick both ends
        out.append(tri * vol * k)
    return out


def voice_pulse(freq, length, duty, vol, rate):
    out = []
    phase = 0.0
    n = int(length * rate)
    for i in range(n):
        t = i / rate
        phase = (phase + freq / rate) % 1.0
        s = 1.0 if phase < duty else -1.0
        # Quick decay to a sustain level, then release near the end.
        e = 0.6 + 0.4 * max(0.0, 1.0 - t / 0.08)
        k = min(1.0, (n - i) / (0.01 * rate), i / (0.002 * rate))
        out.append(s * e * k * vol)
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

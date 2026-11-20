#!/usr/bin/env python3
"""Generate the tetris sound effects in assets/sfx/.

Original chiptune-style sounds (pulse waves and noise, like an 8-bit console's
sound chip). Standard library only, deterministic output:

    python3 scripts/generate-tetris-sfx.py
"""

import os
import struct
import wave

RATE = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "sfx")


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


def write(name, samples, gain=0.35):
    path = os.path.join(OUT_DIR, f"{name}.wav")
    peak = max(1e-6, max(abs(s) for s in samples))
    scale = gain / peak
    # 5 ms fade-out to avoid a click at the end.
    fade = int(0.005 * RATE)
    data = bytearray()
    for i, s in enumerate(samples):
        k = min(1.0, (len(samples) - i) / fade)
        data += struct.pack("<h", int(max(-1.0, min(1.0, s * scale * k)) * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(data))
    print(f"wrote {os.path.relpath(path)} ({len(samples) / RATE * 1000:.0f} ms)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

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

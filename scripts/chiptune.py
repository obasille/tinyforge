"""Shared chiptune synth helpers for the audio generator scripts.

Pulse, triangle and noise voices (like an 8-bit console's sound chip), a
note-name parser and a WAV writer. Standard library only, deterministic.
"""

import os
import struct
import wave

RATE = 44100
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
OUT_DIR = os.path.join(ASSETS, "sfx")
MUSIC_DIR = os.path.join(ASSETS, "music")


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

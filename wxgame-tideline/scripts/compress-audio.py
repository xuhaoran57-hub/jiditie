"""Encode the source BGM as 96 kbps mono MP3, retaining LAME gapless metadata.

Usage: python scripts/compress-audio.py [--lame /path/to/libmp3lame]
The encoder is a build tool only; its library is never shipped with the game.
"""
import argparse
import ctypes as c
import ctypes.util
from pathlib import Path
import wave


def encode(library: str) -> None:
    root = Path(__file__).resolve().parent.parent
    source = root / "assets/audio/tideline-loop.wav"
    target = root / "assets/audio/tideline-loop.mp3"
    with wave.open(str(source), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 22050):
            raise ValueError("Expected 22050 Hz / 16-bit / mono source WAV")
        samples = wav.getnframes()
        pcm = (c.c_short * samples).from_buffer_copy(wav.readframes(samples))

    lib = c.CDLL(library)

    def bind(name, result, *args):
        function = getattr(lib, name)
        function.restype, function.argtypes = result, list(args)
        return function

    pointer, byte_pointer = c.c_void_p, c.POINTER(c.c_ubyte)
    init = bind("lame_init", pointer)
    initialize = bind("lame_init_params", c.c_int, pointer)
    close = bind("lame_close", c.c_int, pointer)
    encode_buffer = bind("lame_encode_buffer", c.c_int, pointer,
                         c.POINTER(c.c_short), c.POINTER(c.c_short), c.c_int,
                         byte_pointer, c.c_int)
    flush = bind("lame_encode_flush", c.c_int, pointer, byte_pointer, c.c_int)
    tag_frame = bind("lame_get_lametag_frame", c.c_size_t, pointer, byte_pointer, c.c_size_t)
    encoder = init()
    if not encoder:
        raise RuntimeError("Could not initialize LAME")
    try:
        for name, value in [("num_channels", 1), ("in_samplerate", 22050),
                            ("out_samplerate", 22050), ("mode", 3),
                            ("brate", 96), ("quality", 2), ("bWriteVbrTag", 1)]:
            if bind("lame_set_" + name, c.c_int, pointer, c.c_int)(encoder, value) < 0:
                raise RuntimeError("Invalid LAME option: " + name)
        if initialize(encoder) < 0:
            raise RuntimeError("LAME initialization failed")
        buffer = (c.c_ubyte * (samples * 2 + 7200))()
        size = encode_buffer(encoder, pcm, pcm, samples, buffer, len(buffer))
        if size < 0:
            raise RuntimeError("MP3 encoding failed")
        encoded = bytearray(buffer[:size])
        size = flush(encoder, buffer, len(buffer))
        if size < 0:
            raise RuntimeError("MP3 flush failed")
        encoded.extend(buffer[:size])
        size = tag_frame(encoder, buffer, len(buffer))
        if not 0 < size <= len(encoded) or size > len(buffer):
            raise RuntimeError("Missing LAME delay/padding metadata")
        encoded[:size] = buffer[:size]
        if len(encoded) > 256 * 1024:
            raise RuntimeError("MP3 exceeds the 256 KiB budget")
        target.write_bytes(encoded)
        print(f"{source.stat().st_size} -> {len(encoded)} bytes; {samples / 22050:.3f}s")
    finally:
        close(encoder)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lame", default=ctypes.util.find_library("mp3lame"))
    args = parser.parse_args()
    if not args.lame:
        parser.error("Install libmp3lame or pass --lame with its library path")
    encode(args.lame)

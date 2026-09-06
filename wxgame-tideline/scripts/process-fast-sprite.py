"""Remove the generated checkerboard and pack the four runner poses into 64px frames."""
from collections import deque
from pathlib import Path
import sys

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "references" / "tideline-fast-sprite-sheet-v2.png"
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "assets" / "generated" / "tideline-passenger-fast-sprite.png"


def remove_connected_neutral_background(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return min(r, g, b) >= 215 and max(r, g, b) - min(r, g, b) <= 18

    for x in range(width):
        for y in (0, height - 1):
            if is_background(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_background(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index] or not is_background(x, y):
            continue
        visited[index] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                neighbor = ny * width + nx
                if not visited[neighbor]:
                    queue.append((nx, ny))

    result = image.convert("RGBA")
    alpha = result.getchannel("A")
    alpha_pixels = alpha.load()
    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                alpha_pixels[x, y] = 0
    result.putalpha(alpha)
    return result


def pack(image: Image.Image) -> Image.Image:
    width, height = image.size
    output = Image.new("RGBA", (256, 64), (0, 0, 0, 0))
    for frame in range(4):
        left = round(frame * width / 4)
        right = round((frame + 1) * width / 4)
        tile = image.crop((left, 0, right, height))
        bbox = tile.getchannel("A").getbbox()
        if not bbox:
            continue
        crop = tile.crop(bbox)
        side = max(crop.width, crop.height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.alpha_composite(crop, ((side - crop.width) // 2, side - crop.height))
        canvas.thumbnail((58, 58), Image.Resampling.LANCZOS)
        output.alpha_composite(canvas, (frame * 64 + (64 - canvas.width) // 2, 3))
    return output


def main() -> None:
    processed = remove_connected_neutral_background(Image.open(SOURCE))
    packed = pack(processed)
    packed.save(OUTPUT, format="PNG", optimize=True)
    print(f"generated {OUTPUT}")


if __name__ == "__main__":
    main()

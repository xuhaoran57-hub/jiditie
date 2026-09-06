"""Compose the six individual 256x64 passenger sheets into one runtime atlas."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "generated"
OUTPUT = ASSETS / "tideline-passenger-atlas.png"
KINDS = ("regular", "fast", "slow", "luggage", "phone", "group")


def main() -> None:
    atlas = Image.new("RGBA", (256, 384), (0, 0, 0, 0))
    for row, kind in enumerate(KINDS):
        sheet = Image.open(ASSETS / f"tideline-passenger-{kind}-sprite.png").convert("RGBA")
        if sheet.size != (256, 64):
            raise ValueError(f"{kind} sprite must be 256x64, got {sheet.size}")
        atlas.alpha_composite(sheet, (0, row * 64))
    atlas.save(OUTPUT, format="PNG", optimize=True)
    print(f"generated {OUTPUT}")


if __name__ == "__main__":
    main()

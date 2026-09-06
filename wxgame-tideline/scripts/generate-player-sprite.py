"""Generate the small, project-owned player sprite atlas used by the wx game.

The SVG in assets/generated is the editable source.  This script keeps a
runtime-friendly PNG alongside it for devices whose image decoder does not
support SVG.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "generated" / "tideline-player-sprite.png"
SCALE = 4


def xy(value):
    return int(round(value * SCALE))


def box(values):
    return tuple(xy(value) for value in values)


def draw_frame(draw, offset, mode):
    ox = offset
    ink = "#15263c"
    skin = "#f3c5a2"
    shirt = "#36c8bb"
    shirt_shadow = "#167c83"
    hair = "#152c44"
    shoe = "#07121e"

    def ellipse(values, fill, outline=None, width=1):
        draw.ellipse(box((values[0] + ox, values[1], values[2] + ox, values[3])), fill, outline, width=xy(width))

    def rounded(values, radius, fill, outline=None, width=1):
        draw.rounded_rectangle(box((values[0] + ox, values[1], values[2] + ox, values[3])), radius=xy(radius), fill=fill, outline=outline, width=xy(width))

    def line(points, fill, width=1):
        draw.line([(xy(x + ox), xy(y)) for x, y in points], fill=fill, width=xy(width), joint="curve")

    # Dynamic shadow is drawn by actor-renderer; this subtle local shadow keeps
    # the sprite readable in the carriage and matches the NPC atlas treatment.
    ellipse((19, 54, 45, 60), "#102b3a")
    left_foot = 21 if mode == 1 else 24
    right_foot = 43 if mode == 2 else 40
    line([(26, 45), (left_foot, 54)], shoe, 4)
    line([(38, 45), (right_foot, 54 if mode != 1 else 52)], shoe, 4)
    line([(left_foot - 2, 54), (left_foot + 4, 54)], "#4d7280", 1)
    line([(right_foot - 2, 54), (right_foot + 4, 54)], "#4d7280", 1)
    rounded((20, 27, 44, 49), 8, shirt_shadow, ink, 2)
    rounded((22, 25, 42, 45), 7, shirt, ink, 2)
    line([(24, 43), (32, 46), (40, 43)], "#a7fff0", 1)
    line([(26, 27), (32, 33), (38, 27)], "#d5fff6", 1)

    if mode == 3:
        line([(22, 32), (14, 38)], skin, 3)
        line([(42, 32), (52, 20)], skin, 3)
        ellipse((13, 37, 15, 41), "#ffd9bd")
        ellipse((51, 19, 53, 21), "#ffd9bd")
    elif mode == 1:
        line([(22, 32), (14, 37)], skin, 3)
        line([(42, 32), (50, 37)], skin, 3)
    else:
        line([(22, 32), (14, 39)], skin, 3)
        line([(42, 32), (50, 39)], skin, 3)

    ellipse((20, 6, 44, 30), skin, ink, 2)
    # Hair cap and fringe.
    draw.pieslice(box((21 + ox, 7, 45 + ox, 25)), 180, 355, fill=hair, outline=ink, width=xy(2))
    line([(24, 17), (28, 13), (32, 17), (36, 12), (41, 18)], hair, 2)
    line([(25, 10), (32, 6), (40, 10)], "#45627d", 1)
    ellipse((26.5, 18.5, 29.5, 21.5), ink)
    ellipse((34.5, 18.5, 37.5, 21.5), ink)
    line([(27, 16), (30, 15)], ink, 1)
    line([(34, 15), (37, 16)], ink, 1)
    line([(29, 25), (32, 26), (35, 25)], ink, 1.5)
    rounded((14, 29, 20, 42), 2, "#28445a", ink, 1.5)
    line([(15, 31), (15, 40)], "#7ff0c8", 1)
    if mode == 3:
        line([(49, 14), (54, 11), (58, 13)], "#7ff0c8", 2)
        line([(51, 9), (56, 7), (60, 9)], "#7ff0c8", 2)


def main():
    image = Image.new("RGBA", (256 * SCALE, 64 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for frame in range(4):
        draw_frame(draw, frame * 64, frame)
    image = image.resize((256, 64), Image.Resampling.LANCZOS)
    image.save(OUTPUT, format="PNG", optimize=True)
    print(f"generated {OUTPUT}")


if __name__ == "__main__":
    main()

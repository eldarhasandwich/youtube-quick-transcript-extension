from pathlib import Path
from PIL import Image

icons = Path(__file__).resolve().parent / "icons"

with Image.open(icons / "fullsize.png") as source:
    source = source.convert("RGBA")

    for size in (16, 32, 48, 128):
        icon = source.copy()
        icon.thumbnail((size, size), Image.Resampling.LANCZOS)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(
            icon,
            ((size - icon.width) // 2, (size - icon.height) // 2),
        )

        output = icons / f"icon{size}.png"
        canvas.save(output)
        print(f"Created {output}")
---
name: gallery
description: Find references and reusable parts in the owner's World Material Library gallery and use them in a design. Use when you design something for the owner of this gallery, before you invent a look of your own.
---

# Use the gallery

The owner of this gallery saves images they like. Some of them have been studied: their reusable parts were taken out, each with a picture, usually an editable file, and words that say what it is for. A design built from these parts comes out in the owner's taste, not in yours.

## Search

`find.js` in this folder reads the library from disk. It needs no server and no network.

    node find.js quiet background --in parts --format svg

- **Words.** All of them have to match. Search for the job first ("divider", "quiet background", "flat landscape"), then for a subject. Without words, everything is listed, newest first.
- **`--in parts`, `--in references` or `--in both`** (the default). A part's words describe its job; a reference's words describe what the image shows.
- **`--format svg,html,image`.** `svg` and `html` are parts with an editable file. `image` is a part that is only a picture, or a reference's photo.
- **`--limit 10`**, **`--files`** to print the text of each part's files, **`--json`** for JSON.

When the app is running, `GET /api/library/search?q=…&in=…&format=…&limit=…&files=1` gives the same answer as `--json`.

## What a result tells you

A **part**:

- `use` says when to reach for it and names one limit. `answers` are requests it fits.
- `file` is its editable file. Open `picture` and look at the part before you use it.
- "Colours you can set" are CSS variables. Set them on an element around the part; the values in the file are the ones measured from the owner's image.
- A part drawn by a function has parameters. The function file exports `params` and `render(p)`: start from each parameter's `value`, change what you need, and `render` returns the SVG as text. Parameters marked free are yours to change. Parameters that carry the look stay inside their range, or the part is no longer what the owner saved.
- A picture-only part cannot be edited. Place it as an image, or use it as a reference for a texture.

A **reference** is an image the owner liked, with a description of it. Use it for direction when no part fits. Look at it; do not copy it.

## Using what you find

- Prefer a part to inventing something similar.
- Say which parts you used, by their ids, so the owner can see where the design came from.
- Say so when you went outside a range that carries the look.

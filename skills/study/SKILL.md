---
name: study
description: Study a reference image from the Spar gallery. Pick out what is unusual and reusable in it, and save each part beside the reference as a picture, an editable file and words to find it by. Use when asked to study, extract from, or take apart a reference.
---

# Study a reference

A study turns one saved image into parts that someone can design with.

Without a study, a reference is a picture and a description of its subject. An agent that wants to design from it has to work everything out again by eye, and the owner of the gallery never sees what it concluded. A study does that work once, checks it against the image, and saves it where it can be found, used and corrected.

## Who uses what you save

Three readers, and none of them can ask you a question.

- **The owner of the gallery** sees each part as a small picture with a name and a few keywords under it, and keeps it or drops it. The picture has to show exactly what a designer would get.
- **A design agent searching the gallery, weeks later,** has a need in mind, such as "a divider" or "a background with depth". It finds parts by their words. The words have to say what a part does, not what the image showed.
- **The same agent, once it has picked a part,** pastes the file or changes it to fit. It needs code and exact values, and it needs to know which numbers it may change.

So every part is three things: a picture, an editable file, and words to find it by.

## The hard part is choosing

An image has dozens of properties you could describe. Only a few are the reason someone kept it. Your own sense of what looks good is the weakest evidence you have about that, so do not choose by it. Use these, strongest first:

1. **The owner's signals.** The box they drew (`boundingBox` in `reference.json`) says where they were looking. A note, if they left one, says what they liked. `taste.md` in the gallery's data folder, if it exists, holds what they said about earlier studies. These outrank your judgement.
2. **What is unusual.** You know very well what the ordinary version of any kind of image looks like: the average conference poster, the average landscape photo, the average landing page. That knowledge is more reliable than taste. Describe the ordinary version of this image, then list what this one does differently on purpose. Each deliberate difference is a candidate. A property the ordinary version shares, such as "clear hierarchy" or "good use of white space", is not.
3. **What transfers.** Keep a candidate only if you can state it without naming the subject and it would still work on different content. "Six jets in an arrowhead" does not transfer. "A tight cluster of small dark marks covering 2% of an empty field" does. A chart or diagram is not only content: its data and labels are, but the way it is drawn (the shapes of its nodes, its line styles, how colour separates its groups, how small copies are arranged) is design, and is often the most distinctive thing on a poster or a slide. Take the way it is drawn and fill it with invented data.
4. **What can be built.** Prefer candidates you can write as numbers, geometry or code, because those can be checked and changed. What you can only show becomes an image-only part. What you can only describe goes in `notes`.

Something is deliberate, not an accident, when it repeats, when it is applied consistently, or when the image is organised around it.

Aim for three to six parts. A study with fifteen parts has not chosen.

## Three ways a part is used

Decide this for each part before you build it. It settles which file you write and what "matches the reference" means.

| `use_as` | What it is | Editable file | It matches when |
|---|---|---|---|
| `place` | a graphic dropped into a design: a shape, a motif, a pattern, line work, a gradient, the drawing of a figure, a flat picture of the scene | `.svg` (written by a `.js` function when it follows a rule) | shapes, proportions, line weights and colours agree with the region |
| `fill` | a container that takes content: a box, a heading, a card, a banner, a callout, a pairing of type | `.html` with inline styles | borders, spacing, type sizes and colours agree; the words are placeholders and do not count |
| `follow` | an arrangement to copy: the layout of a page, a poster or a screen | `.svg` wireframe: plain rectangles and lines where the content was | every block covers the area of what it stands for; what is inside the blocks does not count |

## Method

Each step is here because skipping it causes a known failure, named in brackets.

1. **Look twice.** Open the whole image, then enlarge the regions that matter with `crop` and `grid`. The whole image as you first see it is scaled down; line weights, type and edges only show up close. [describing an impression]
2. **Say what kind of image it is and what it can give.** A photo gives colour, tone, light, composition, texture, and sometimes a shape or a rhythm. A poster, page or screen also gives layout, type, parts and figures. An illustration gives shape and line. Name the aspects that apply and the ones that do not. [forcing a poster's fields onto a photo]
3. **List candidates before building anything.** Five to eight. For each: where it is, what the ordinary version would have instead, and how you would save it. If the owner is with you, show them the list and ask which ones they want, in one question. If not, take the strongest and leave `"confirmed": false`. [polishing the wrong thing]
4. **Measure.** Colours come from pixels (`sample`, `palette`), gradients from `ramp`, positions and sizes from `grid`, outlines from `trace` when the shape is flat enough. Give every value its source: `measured` (a tool reported it), `estimated` (you read it off a crop or the grid), or `guessed` (font names, and anything else you cannot verify). [confident wrong numbers]
5. **Write the editable file.** The next section says how. [a picture nobody can change]
6. **Run `page` and compare.** For each part it writes `parts/<id>.check.png`: the region in the reference, your part drawn at the same size, the two laid over each other, then the variants. Open every one. Write down what differs by the test in the table above, fix the file, and run `page` again. After three rounds of fixes, look once more and record what still differs in `check.still_differs`. `check.rounds` counts the rounds in which you changed the file; if you accept a part without changing it, say there what you compared. A part that is still far off is in the wrong form: change the form, or make it image-only. [code that was never looked at]
7. **Show what can change.** Give every editable part one to three `variants`: other colours, or other parameters. `page` draws them. A part that only works exactly as it appeared in the image is a copy, not a part. [copying the image]
8. **Write the words** after the part is built, so that they describe what you built. [parts nobody can find]
   - `name`: two to five plain words for what it is, written as a phrase a person would say and not as a title: "dots that grow toward one corner", not "Gradient Dot Cascade".
   - `keywords`: three to six short phrases for its look and its job, such as "dotted rule" or "pull quote". Never the scene the image shows: a designer who needs a divider does not search for "lighthouse". A flat picture of the scene and a picture-only part are the exceptions. They show the scene or a piece of it, so their names and keywords say what they show, such as "harbour at dusk" or "wood grain".
   - `answers`: two to four requests a designer might type that this part would answer, in their words, such as "a quiet background behind a headline".
9. **Report.** See the end of this file.

## The editable file

One file per part, in `parts/`, named after the part's id. `page` draws the part's picture from this file, so the picture can never show something the file does not hold. You never draw or save that picture yourself.

- **Write lengths in the reference's own pixels.** `page` draws your file in a box that has the pixel size of the region in `where`: a region of 377 by 474 pixels gives a box of 377 by 474 CSS pixels. It then enlarges your part and the region by the same amount. A border two pixels thick in the image is `2px` in your file.
- **An `.svg` fills the box.** Give it a `viewBox` of the region's pixel size, so that its lengths are the image's lengths too.
- **An `.html` file is a fragment** laid out in the box: no `<html>` or `<body>`, inline styles only, fonts that are already on the machine.
- **Write colours as variables with the measured value as the fallback:** `fill="var(--ink, #1d2b34)"` in SVG, `color: var(--ink, #1d2b34)` in CSS, or `currentColor` for a shape of one colour. The file then draws correctly alone, and a designer can recolour it without editing it.
- **Use what a design tool can open:** paths, basic shapes, gradients, patterns and clip paths. No script, nothing loaded from outside the file, no `<foreignObject>`, no bitmap inside it.
- **Take the design and leave the content.** No text, logo, face or data from the image goes into a file. Put neutral words of the same length where words were, and invented data of the same shape where data was.

**Draw a scene as a minimalist flat picture.** A photograph or an illustration of a scene gives one part of this kind, in place of a diagram of its composition: the scene itself, redrawn the way a minimalist flat landscape poster is drawn. It is a `place` part with the whole image as its region, and the one part that shows the subject.

- Each large mass is one simplified shape in one flat colour. Layer them from back to front: sky, far ridge, middle distance, near masses, water or ground, foreground.
- Give each mass the outline that makes it recognisable in a small picture: a peak with two or three snow facets, a shoreline as one curve, a row of conifers as pointed trees of the heights you measured. Simplify every mass to the same degree. Never stand a rectangle in for a mass that has a shape, and never draw one mass finely beside a crude one.
- Use five to eight colours, sampled from the masses, each written as a variable. One gradient is allowed, for the sky or the water.
- A reflection is the same shapes mirrored below the waterline, a little shorter and lower in contrast.
- Repeated things, such as trees, posts or waves, come from a function, so that their number and size can change.
- Leave out texture, small objects and noise.

It matches when, in the overlay, every outline runs along the edge of its mass, and when the small picture reads at a glance as the same scene.

**Draw a layout as a wireframe.** For a page, a poster or a screen, a `follow` part says where things sit and how big they are, not what they are. Use rectangles, bands and straight lines only, in greys on a pale ground, with one accent colour for the block the eye goes to. Six shapes are usually enough.

**When a graphic follows a rule, save the rule.** A pattern, a rhythm, a grid of marks or a fan of lines is made by a few numbers. Write it as `parts/<id>.js`, and `page` runs it and writes `parts/<id>.svg` for you:

```js
module.exports = {
  params: {
    // one entry for each thing a designer can change
    <name>: { value: <what you measured>, min: <lowest that still works>, max: <highest>, role: "look", note: "<what it changes>" },
    <name>: { value: …, min: …, max: …, role: "free", note: "…" },
  },
  render(p) {
    // p holds every param by name. Arithmetic and string building only: no require, no files.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 … …">…</svg>`;
  },
};
```

`role` is what keeps a later designer inside what the owner saved. `"look"` marks a number that carries the look: outside its range the part is no longer this part. `"free"` marks a number a designer changes to fit, such as a count or a size. Give at least one variant that changes a `free` parameter a lot, and look at it. The same parameters must always give the same output.

**When a part cannot be drawn, say so.** A photographic texture has no editable form: drawn as shapes it becomes something else. Leave out `file` and give `image_only` with the reason. Its picture is then the region itself. Use this for what is truly photographic, not for what is hard. An image-only part never stands in for one you can draw: when a region holds a texture and also a pattern, a shape or a rhythm, save the one you can draw as a part of its own, with a file.

## Tools

`scripts/look.js` in this folder. Run it with `node`; without arguments it lists its commands. Every box is `x,y,w,h` and every point is `x,y`, in fractions of the whole image, with `0,0` at the top left.

| Command | Use it to |
|---|---|
| `grid <image> <out.png> [--box …] [--step …]` | read positions and sizes off a labelled grid |
| `crop <image> <out.png> --box …` | see a region enlarged |
| `sample <image> --box name=… [--box …]` | get the colours inside regions you choose |
| `palette <image> [--box …]` | get dominant colours by area, plus small vivid ones that area hides |
| `ramp <image> --from x,y --to x,y` | get the colours along a line, as gradient stops |
| `trace <image> <out.svg> --box …` | get the outline of a flat shape as SVG; it also writes a preview to check |
| `shot <page.html> <out.png>` | render any page you wrote |
| `pair <a.png> <b.png> <out.png>` | put two images side by side |
| `page <study.json>` | check the study, draw every part, and write the pictures and comparisons |

`page` stops and lists what is wrong when the study or a file breaks a rule. When it does draw, read what it prints under "Worth fixing" and act on it: colours marked `measured` that do not occur in the image, files that cannot be recoloured or opened in a design tool, and words that say nothing a designer can act on.

## What to save

Write only inside the reference's folder. Do not change `image.*` or `reference.json`.

You write `study.json` and the files in `parts/`. `page` writes the rest: `parts/<id>.png` (the part's picture), `parts/<id>.crop.png` (the region it came from), `parts/<id>.check.png`, `parts/index.json`, `study.html` and `study.png`.

```json
{
  "reference": "<id of the reference>",
  "title": "<its title>",
  "kind": "<what kind of image this is, in a few words>",
  "gives": ["<aspects this image can give>"],
  "does_not_give": ["<aspects it cannot>"],
  "ordinary_version": "<one or two sentences describing the average image of this kind>",
  "focus": { "box": [0, 0, 1, 1], "note": "<the owner's note, or null>" },
  "confirmed": false,
  "agent": "<your model name>",
  "studied_at": "<date>",
  "candidates": [
    { "name": "…", "where": [0, 0, 1, 1], "instead_of": "<what the ordinary version has here>", "form": "<how it is saved>", "taken": true },
    { "name": "…", "instead_of": "…", "taken": false, "why_not": "<does not transfer, looks accidental, or the owner's signals point elsewhere>" }
  ],
  "colours": [
    { "role": "<what the colour does>", "hex": "#rrggbb", "share": 0.62, "source": "measured" }
  ],
  "parts": [
    {
      "id": "<short-slug>",
      "name": "<two to five plain words; only a flat picture of the scene or a picture-only part names the subject>",
      "use_as": "<place, fill or follow>",
      "aspect": "<scene, colour, light, tone, layout, type, part, figure, shape, pattern, texture or line>",
      "where": [0, 0, 1, 1],
      "keywords": ["<three to six, for the look and the job>"],
      "answers": ["<two to four requests this part answers>"],
      "unusual": "<what the ordinary version would have instead, and how this differs>",
      "use": "<when a designer should reach for this, and one limit on it>",
      "file": "parts/<short-slug>.svg",
      "made_by": "parts/<short-slug>.js",
      "variants": [
        { "label": "<what changed, in a few words>", "vars": { "--<name>": "<value>" }, "color": "<colour>", "background": "<colour>", "params": { "<name>": "<value>" } }
      ],
      "stage": { "background": "#ffffff", "color": "#111111" },
      "values": { "<name>": { "value": "<number, colour or ratio>", "source": "measured" } },
      "check": { "rounds": 2, "still_differs": ["<what your file still gets wrong>"] }
    }
  ],
  "rules": [{ "rule": "<a decision that holds across the image>", "evidence": "<where it shows, with numbers>" }],
  "notes": ["<seen and possibly important, but not built>"],
  "questions": ["<the question whose answer would change this study most>"]
}
```

How the fields behave:

- `where` is the region the part was taken from, and it sets the size of the box the file is drawn in. Use the whole image for a part that describes all of it.
- `file` is `parts/<id>.svg` or `parts/<id>.html`. Add `made_by` only for a function; then `page` writes the `.svg`, and you never edit that by hand.
- An image-only part has `"image_only": "<the reason>"` in place of `file`, `made_by` and `variants`.
- A variant sets any of: `vars` (CSS variables), `color` (what `currentColor` follows), `background` (what is behind the part), and `params` (for a function, each inside its range).
- `stage` is what is behind the part in its own picture. Leave it out for white with near-black text.
- In `colours`, `source` is about the hex. `share` is always approximate.
- For a `follow` part, also give the blocks in `values`, as fractions of the frame. An agent builds from those numbers; the diagram is for the owner.

## Staying honest

- Never give an estimate as a measurement. A wrong number marked `measured` is worse than no number, because the next agent will trust it.
- Font names read off an image are guesses. Say what you can see (serif or sans, weight, proportions) and name the closest fonts as guesses. To test a guess, set one line of the image's own words in it at the measured size and compare its width with the crop; then put the neutral words back.
- If the image holds little that is unusual, say so and keep the study small. Colour, light and the flat picture of the scene are a complete study of a good photograph.
- Write what you measured or saw. Words such as "clean", "modern" and "elegant" are true of everything and tell a designer nothing.
- When your file still differs from the reference, say how in `check.still_differs`. The owner decides from the picture, and the next agent decides from what you wrote.

## Report

End with a short message to the owner:

- the parts you took, and for each, what the ordinary version would have had instead
- which parts are image-only, and why
- what you are unsure about, and what your files still get wrong
- one question: the one whose answer would change the study most

If the owner corrects you, change the study, set `"confirmed": true` once they agree, and add their words to `taste.md` in the gallery's data folder, with the date and the reference id, so the next study starts from what they said.

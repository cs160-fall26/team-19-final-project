# World Material Library — Design Reference Capture

World Material Library is a minimal design-reference library. Upload or browse photos, inspect an extracted region, read auto labels and a semantic write-up, open a map of where it was captured, and **Copy Prompt** for any generative AI tool.

## Features

- **Library** — multi-column square thumbnail grid with Geist Mono header and Geist Pixel wordmark
- **Search** — type words to find references by label, title or description. Plurals, half-typed words and typos are understood, every word has to match, and existing labels are offered as you type. Under the matches, a **Related** group lists references that are close in meaning even when they share no word with the query (found with OpenRouter embeddings)
- **Parts search** — switch the search box from References to Parts to search what deep analyses have extracted, by keyword, name and use, with the same matching. A result opens its reference with that part shown
- **Colour search** — pick black, grey, white or a hue on the colour bar to find references whose palette holds that colour. Words and colour can be combined
- **Map view** — switch the library from Grid to Map to see every reference that has a GPS position as a round photo bubble. Photos taken close together share one marker: a slightly bigger bubble with up to five of the others as small bubbles around it, and the number of photos there. Clicking it zooms in or lists them. The search and the colour pick apply to the map too
- **Detail** — split layout with bounding box overlay, semantic text, collapsible metadata (closed by default), map (open by default)
- **Upload** — choose a photo, draw a box around the element you want extracted (drag to draw, drag the box to move it, drag a corner to resize it), then pick a light or a deep analysis
- **Metadata** — capture date, camera, lens, exposure and GPS position are read from the file's EXIF in the browser; the palette is computed from the boxed pixels. A field the file does not carry is left out, never invented
- **Description** — a vision model on OpenRouter writes the title, labels, semantic write-up and prompt for the boxed element. This is the light analysis
- **Deep analysis** — on request, a Codex session studies the reference and saves its reusable parts. Each part is a picture, an editable file (SVG, HTML, or a small function that draws the SVG) and words to find it by. The reference's page shows the parts under the photo
- **Map** — the pin sits at the photo's GPS position; a photo without one shows no map
- **Persistence** — references are stored on disk in the project's `data/` folder, one folder per reference, so the library does not depend on any browser

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Geist (Sans / Mono / Pixel) · Leaflet

## Run locally

```bash
npm install
npm run dev
```

Dev server binds to **http://127.0.0.1:3847**.

```bash
npm run build
npm run start
```

## OpenRouter key

Create `.env.local` in the project root (it is git-ignored):

```bash
OPENROUTER_API_KEY=sk-or-...
# Optional. Any OpenRouter model that accepts images and structured output.
OPENROUTER_MODEL=google/gemini-4-hydrogen
# Optional. The embedding model behind the Related search results.
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
```

The key is read only on the server and never reaches the browser. Two routes use it:

- `src/app/api/extract/route.ts` sends a new photo and its boxed crop to the vision model. Without a key, uploads fail with a message saying so.
- `src/app/api/search/route.ts` sends text to the embedding model: the title, labels and description of each reference (once, when it is saved or first searched) and each search query. Photos are never sent for search. Without a key, search still finds keyword and colour matches and says that related results are unavailable.

Changing the embedding model re-embeds the library on the next search. What counts as related was tuned for the default model (`MIN_SCORE` in `src/lib/semantic-search.ts`); another model may need different numbers.

## Deep analysis with Codex

A light analysis is what the vision model writes in a few seconds. A deep analysis adds a study by a Codex session: it picks out what is unusual and reusable in the image and saves each part with a picture, an editable file and search words. `skills/study/SKILL.md` is what the agent is told to do.

Choose **Deep** in the upload dialog, or press **Run deep analysis** on a reference's page. You can add a note saying what you like about the image; the agent treats it as the strongest hint about what to extract. The page shows the run while it works and the parts when it has finished. A run takes about three to ten minutes and keeps going if you close the page.

It needs two things on the computer World Material Library runs on:

- the Codex CLI, logged in: `npm install -g @openai/codex`, then `codex login`. Runs use that account's allowance
- Chrome, which draws the parts' pictures

Optional settings in `.env.local`:

```bash
SPAR_STUDY_MODEL=gpt-6.1-sol     # the Codex model
SPAR_STUDY_EFFORT=high           # its reasoning effort
SPAR_STUDY_MINUTES=30            # when a run is given up
```

What a run sees and does:

- It works on a copy: the photo, and the title, labels, description and box. The photo's position, date, camera and file name are not in that copy. The photo itself goes to OpenAI as part of the Codex session
- Codex is sandboxed. It can write only inside its working folder and has no network
- Nothing the agent writes is run by World Material Library. The app shows the parts' pictures and offers their files as text to copy
- A study reaches the library only when the run succeeded. The study it replaces is kept in the run's folder

## Search for agents

An agent that is designing something can search the gallery too: the references, the parts, or both, and only some file formats if it wants.

```bash
node skills/gallery/find.js quiet background --in parts --format svg
node skills/gallery/find.js fog --in both --limit 5
node skills/gallery/find.js --in parts --format svg,html --files --json
```

- `--in parts`, `--in references` or `--in both` (the default)
- `--format svg,html,image`: `svg` and `html` are parts with an editable file; `image` is a picture-only part or a reference's photo
- `--files` adds the text of each part's file and of the function behind it; `--json` prints JSON

The script reads the library from disk, so it works when World Material Library is not running and inside a sandbox without network. While it runs, `/api/library/search?q=quiet+background&in=parts&format=svg` gives the same answer as `--json`. `skills/gallery/SKILL.md` tells an agent how to use what it finds.

## Your library on disk

Every reference is a folder holding its photo and its description:

```
data/
  references/
    upload-1763500000000/
      image.jpg        the photo as the app keeps it (longest edge 1600 px)
      reference.json   title, labels, description, prompt, box, location, metadata
      embedding.json   what search uses to find related references; safe to delete, it is rebuilt
      study.json       after a deep analysis: the parts the agent chose, and why
      parts/           after a deep analysis: each part's pictures (.png), its editable file (.svg or .html) and, for some, the function that draws it (.js)
  study-runs/
    upload-1763500000000/   the latest deep analysis run: its status, its transcript and the folder the agent worked in; safe to delete when no run is working
```

- `data/` is git-ignored, so photos and their GPS positions stay out of the repository. To back the library up, copy the folder.
- To keep the library somewhere else, set `SPAR_DATA_DIR` in `.env.local` to an absolute path, a `~/…` path, or a path relative to the project root, then restart the server.
- Earlier versions kept the library in the browser's IndexedDB. The first time this version is opened in that browser, at the same address as before, it copies those references to disk and says so above the grid. The browser's copy is left in place.

## Where things live

- `src/lib/photo.ts` — EXIF and GPS reading, downscaling, cropping, palette
- `src/app/api/extract/route.ts` — the OpenRouter call
- `src/components/box-selector.tsx` — the bounding box tool
- `src/lib/reference-store.ts` — the library on disk (server only)
- `src/app/api/references/` — the routes that list, store and serve references
- `src/lib/storage.ts` — the browser's calls to those routes
- `src/lib/browser-library.ts` — the one-time copy of a library kept in IndexedDB
- `src/lib/search.ts` — keyword matching and label suggestions, run in the browser
- `src/lib/color.ts` — palette matching by hue
- `src/lib/semantic-search.ts`, `src/app/api/search/route.ts` — embeddings and related results
- `src/components/search-controls.tsx`, `src/components/hue-bar.tsx` — the search box and colour picker
- `src/components/library-map.tsx`, `src/components/library-map-inner.tsx` — the map view
- `src/lib/library-url.ts` — the search, colour and view kept in the address bar
- `skills/study/` — the deep analysis: `SKILL.md` (what the agent is told), `scripts/look.js` (its measuring and drawing tool), `scripts/run-codex.js` (runs one study as a Codex session) and `codex-prompt.md` (the prompt that starts it)
- `src/lib/study-store.ts`, `src/app/api/references/[id]/study/` — starting a run, its status, and a study's pictures and files
- `src/lib/study.ts` — the browser's calls to those routes
- `src/components/study-section.tsx` — the parts on a reference's page
- `src/lib/part-search.ts`, `src/lib/use-parts.ts`, `src/components/part-grid.tsx`, `src/app/api/parts/` — searching parts on the library page
- `skills/gallery/` — search for agents: `find.js` (the search itself) and `SKILL.md` (how an agent uses the results)
- `src/app/api/library/search/route.ts` — the same search over HTTP

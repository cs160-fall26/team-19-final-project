# World Material Library — Design Reference Capture

World Material Library is a minimal design-reference library. Upload or browse photos, inspect an extracted region, read auto labels and a semantic write-up, open a map of where it was captured, and **Copy Prompt** for any generative AI tool.

## Features

- **Library** — multi-column square thumbnail grid with Geist Mono header and Geist Pixel wordmark
- **Detail** — split layout with bounding box overlay, semantic text, collapsible metadata (closed by default), map (open by default)
- **Upload** — choose a photo, then draw a box around the element you want extracted (drag to draw, drag the box to move it, drag a corner to resize it)
- **Metadata** — capture date, camera, lens, exposure and GPS position are read from the file's EXIF in the browser; the palette is computed from the boxed pixels. A field the file does not carry is left out, never invented
- **Description** — a vision model on OpenRouter writes the title, labels, semantic write-up and prompt for the boxed element
- **Map** — the pin sits at the photo's GPS position; a photo without one shows no map
- **Persistence** — references are stored in the browser's IndexedDB, so they stay on this device and this browser

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
```

The key is read only by the server route `src/app/api/extract/route.ts`, which receives the photo and its boxed crop and calls OpenRouter. It never reaches the browser. Without a key, uploads fail with a message saying so.

## Where things live

- `src/lib/photo.ts` — EXIF and GPS reading, downscaling, cropping, palette
- `src/app/api/extract/route.ts` — the OpenRouter call
- `src/components/box-selector.tsx` — the bounding box tool
- `src/lib/storage.ts` — IndexedDB persistence

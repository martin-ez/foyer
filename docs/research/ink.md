# Ink: research and early decisions

Research from 2026-11-11, gathered while shaping the Foyer restart. It covers how
handwriting is captured, stored, drawn, erased and searched. It is background
for implementation, not a decision record: the decisions it supports go to
`decisions/` once the repository exists.

## Decided so far

- **We own the ink format.** A stroke is a brush plus a list of sample points.
  PencilKit's format (or any other platform's) is never what we store; SVG and
  PNG are outputs generated from our strokes.
- **A "close enough" look across devices is fine.** Scope is handwriting,
  scribbles and doodles. Artistic brushes are out of scope; revisit the format
  if they come in.
- **Ink always belongs to a page, never to a block or a sticker.** Its
  position is measured either from the page or from a typed text block it was
  drawn on top of, so it moves when that block shifts. The block is only a
  position reference, not an owner. Notes that should travel with a task go on
  the task's own body page.

## Still open

- **Erasing.** Leaning toward partial erase that splits strokes: an erase
  replaces each touched stroke with the pieces that survive, so nothing hidden
  stays in the data. Whole-stroke erase is the same operation with no pieces
  left, so both eraser modes fit.
- **Page size.** Whether pages use real paper sizes (A4 or Letter, in points),
  which recognizers expect and which keeps handwriting the same size across
  views.
- **Languages** the family writes in, which decides the recognizer.
- **Pen lag on iPad** without PencilKit: unmeasured. See [Risk to prototype](#risk-to-prototype).

## The three layers

1. **Capture** (reading the pen) is platform-specific whatever we do.
2. **Storage** (what we save) is the only layer that is expensive to change,
   because changing it means converting every stroke ever drawn.
3. **Rendering** (strokes to pixels) is a function of the stored data and can
   be replaced at any time.

The first Foyer attempt stored PencilKit's own drawing file, which tied storage
to Apple, so other platforms could only show a picture of each note.

## Storage formats compared

| Format | Data kept per sample | Lossy? | Notes |
|---|---|---|---|
| W3C InkML (2011) | Any declared channel: x, y, time, force, tilt, azimuth, rotation | No | Open standard, little tooling. Right idea, verbose XML |
| Jetpack Ink `CodedStrokeInputBatch` | x, y, time, pressure, tilt, orientation, twist | Quantized deltas, gzip | Public proto (Apache-2.0); Ink 1.0 stable since Dec 2025. About 4–6 bytes per sample. Multiplatform API still alpha |
| PencilKit | Smoothed curve points (not raw samples): location, time, size, opacity, force, azimuth, altitude | Yes | You can build a drawing from points, but rebuilt strokes are reported to come out thinner or shifted. Its saved file is an opaque Apple-only blob |
| tldraw draw shape | x, y, pressure | Yes (16-bit floats) | No time or tilt; 600 points per shape at most |
| Excalidraw freedraw | x, y, pressure | No time or tilt | Plain JSON, about 20–40 bytes per point |
| SVG | The outline only | Very | Output only |

Key correction: **PencilKit doesn't expose raw pen samples**, so capturing with
PencilKit would mean storing Apple's smoothed version, not what the pen did.
PencilKit fits better as an optional renderer or recognizer than as capture.

## Proposed stroke schema (a sketch, not a decision)

Mirrors Jetpack Ink's design so its tools stay usable later.

- **Stroke:** id, page, author, device, created time, z-order, input type
  (stylus, touch, mouse), brush (family, version, colour, size), transform,
  bounding box, and a parent id when the stroke came from a split.
- **Samples:** stored column by column, each column as small deltas:
  - x and y in page units
  - time in ms from stroke start
  - pressure 0..1
  - tilt and azimuth, normalized across platforms
- **Page units:** points (1/72 in) on a fixed paper-sized page, origin top-left.
- **Compression:** per page or per sync batch, not per stroke.
- **Rough size:** a short stroke is under 1 KB, and a busy page of 300 strokes
  is about 150–350 KB. These are synthetic estimates.

## Rendering

- **perfect-freehand** (MIT) turns x, y and pressure into an outline. Solid in
  TypeScript and Dart; its Swift and Kotlin ports are hobby projects.
- **google/ink** (Apache-2.0) is the C++ core under Jetpack Ink. It has Android,
  Metal (experimental) and Skia backends, no web binding, and no promise of a
  stable interface.
- **ink-stroke-modeler** (Apache-2.0) only smooths and predicts input.
- **To look the same everywhere,** compile one implementation to every platform.
  Separate rewrites drift. GoodNotes runs one Swift engine on iPad and, via
  WebAssembly, in the browser.
- **Pixels** will be close but not bit-identical, because anti-aliasing and
  GPUs differ.

## Input and lag

| Platform | What it gives |
|---|---|
| iPadOS (UIKit) | force, altitude, azimuth, 240 Hz coalesced and predicted touches, Pencil Pro roll and squeeze |
| Android | pressure, tilt, orientation, hover, batched samples, palm-rejection flag; front-buffered low-lag drawing (API 29+) |
| Safari on iPad | pressure, tilt; since iPadOS 18.2 also altitude/azimuth and coalesced and predicted events |

- **Native custom renderer:** Apple has said one can get "nearly all" of
  PencilKit's low lag (9 ms).
- **Web views:** iPad web views fire pointer events at 60 Hz while the Pencil
  samples at 240 Hz, so without coalesced events 3 of every 4 samples are lost.
- **Flutter:** an open issue reports about one frame of extra touch lag
  compared with native.
- **Unmeasured:** there is no reliable side-by-side comparison on one iPad.

### Risk to prototype

**Pen lag on iPad without PencilKit.** Build three versions and film them at
240 fps:
1. PencilKit, as the baseline.
2. A custom native renderer using coalesced and predicted touches.
3. A browser canvas.

Also check dropped samples, palm rejection, and Scribble interfering with web
canvases.

## Erasing and sync

- **Whole-stroke erase only:** tldraw and Excalidraw.
- **PencilKit:** masks strokes, and since iOS 27 can also split them on erase.
- **Jetpack Ink:** cuts the drawn shape, after which the stroke can't be
  rebuilt from its samples.
- **Splitting by sample range** gives the same result on every platform and
  keeps search working.
- **Sync model sketch:**
  - Strokes are immutable once the pen lifts.
  - Operations are add, delete and split; a split creates new strokes over
    sample ranges and keeps the parent id.
  - Moves and style changes are last-writer-wins.
  - If someone deletes a stroke while someone else splits it, the delete wins.

## Search

| Option | Platforms | Notes |
|---|---|---|
| Google ML Kit Digital Ink | Android, iOS (no web) | Offline after a language download; 300+ languages including Spanish; uses x, y and time |
| Apple `PKStrokeRecognizer` (iOS 27) | iOS, iPadOS, macOS | On-device, 29 languages (Spanish unconfirmed); works on drawings built from our data; store its version and re-index when it changes |
| Vision model on a page image | Anywhere with a server | Also reads drawings and stickers; costs money; on Firebase needs the paid Blaze plan |

All three need stroke order, timestamps, stable stroke ids, a known physical
scale and the writer's language. Pressure and tilt only matter for drawing.

## Sources

- https://developer.android.com/jetpack/androidx/releases/ink
- https://developer.android.com/reference/kotlin/androidx/ink/storage/package-summary
- https://developer.android.com/develop/ui/compose/touch-input/stylus-input/ink-api-state-preservation
- https://github.com/google/ink
- https://github.com/google/ink-stroke-modeler
- https://github.com/steveruizok/perfect-freehand
- https://www.w3.org/TR/InkML/
- https://developer.apple.com/documentation/pencilkit/pkstrokepoint-swift.struct
- https://developer.apple.com/documentation/pencilkit/importing-external-drawing-data-into-pencilkit
- https://developer.apple.com/documentation/pencilkit/pkstrokerecognizer
- https://developer.apple.com/documentation/uikit/uitouch/rollangle
- https://webkit.org/blog/16301/webkit-features-in-safari-18-2/
- https://github.com/excalidraw/excalidraw/pull/11496
- https://tldraw.dev/blog/erasing
- https://github.com/flutter/flutter/issues/110431
- https://www.macrumors.com/2019/06/21/apple-pencil-latency-ipados-developers/
- https://swift.org/blog/bringing-goodnotes-to-web-with-swift/
- https://developers.google.com/ml-kit/vision/digital-ink-recognition
- https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models
- https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features

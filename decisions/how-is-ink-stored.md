# How is ink stored?
Decided in #10 and #18

**Applies when:** saving, syncing, erasing or exporting ink, or adding a new way to capture or draw it.

**Answer:** In Foyer's own platform-neutral format. Each stroke is a brush (tool, colour, size) plus a list of sample points: x and y in page coordinates, time, pressure and tilt, leaving out any value the device can't report. Platform formats, such as PencilKit's drawing data, are never stored. SVG and PNG are only ever generated from Foyer's strokes.

- **Strokes,** in the household's `strokes` table and sent as `foyer.ink.v1.Stroke`:
  - `id`: a UUID version 7, made by the device.
  - `page_id`: the page it's on, which it never leaves (`where-does-ink-belong.md`).
  - `drawn_at`: when the pen touched down, by the device's clock but no later than the change was made. Ink stacks with stickers and text by this time (`what-is-a-page.md`).
  - `drawn_by`: the member who drew it.
  - `input`: what drew it: `pencil`, `finger`, `mouse` or `stylus`, any other pen. Strokes never change, so it's recorded from the first one, for renderers that draw a finger's pen stroke differently.
  - The brush: `tool`, either `pen`, whose width follows pressure, or `monoline`, of even width; `colour`, an opaque sRGB colour, as 0xRRGGBB; and `size`, its width in points, more than 0 and at most 100. How a pen's width follows pressure belongs to the renderer, so it can be tuned without converting ink.
  - `samples`: an encoded `foyer.ink.v1.Samples` message. The household stores and sends the bytes the device encoded, and decodes them only once, to check them, when the stroke is added.
- **Samples:** from 1 to 10,000 per stroke, as one packed list of whole numbers per value, each value the difference from the one before:
  - x and y, in hundredths of a point from the page's top-left corner;
  - time, in milliseconds from the pen touching down;
  - force, in thousandths of the most the device reports;
  - altitude, how far the pen leaned from lying flat, and azimuth, which way it pointed from its tip, from the page's right turning towards its bottom, both in hundredths of a degree.
  - Force, altitude and azimuth are left out when the device can't report them, as for a finger or a mouse. Half a second of handwriting takes under a kilobyte.
- **Changes:** `StrokeAdd {stroke_id, page_id, drawn_at, input, tool, colour, size, samples}`, on a page that has been created, and `StrokeErase {stroke_ids[]}`, which erases up to 1,000 whole strokes, such as every stroke one pass of the eraser crossed.
- **Erasing:** anyone who sees a page can erase any ink on it, as on paper. An erased stroke keeps its row without its samples, so that a page's pull finds it erased (`how-do-devices-stay-in-sync.md`). Erasing it again has no effect.
- **Deleting:** an item's pages are deleted with it, and so is their ink.

Erasing part of a stroke, which replaces it with the pieces that survive, is built by #41.

**Why:** The stored format is the one part of ink that's expensive to change, because changing it means converting every stroke ever drawn. Owning it keeps ink portable across iPad, phones, the web and future styluses, and lets the renderer change without migrating data. It keeps every value the pen reports, which handwriting recognition needs, after only PencilKit's light smoothing on the iPad, so that Skia draws the same points PencilKit drew and the hand-off at pen lift doesn't jump. It holds while ink means handwriting, scribbles and doodles, where a "close enough" look across devices is fine; artistic brushes would need it revisited.

Ink is most of what the household stores (`how-do-devices-stay-in-sync.md`), and packed differences are about a quarter of the size of plain numbers. Storing and sending the same bytes means the household never re-encodes it. Colours are opaque because a translucent ink would darken while PencilKit's and Skia's copies of a stroke overlap at pen lift (#2). Calendar pages are the household's shared board, so anyone can tidy them.

**Rejected:** PencilKit's drawing format, which is Apple-only, opaque and stores already-smoothed points. SVG as the stored format, which loses pressure, timing and stroke order, so strokes can't be redrawn with a better brush or recognised. Plain decimal numbers for every value, which are simpler to read but about four times larger. The Pencil's raw touches recorded beside PencilKit's points, which are exactly what the pen reported, but which Skia would have to smooth to match PencilKit's look, risking a visible change at every pen lift. Erasing only your own ink, which keeps everyone's scribbles safe from others but leaves the shared board untidy until each person cleans up after themselves.

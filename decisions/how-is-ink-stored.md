# How is ink stored?
Decided in #10

**Applies when:** saving, syncing or exporting ink, or adding a new way to capture or draw it.

**Answer:** In Foyer's own platform-neutral format. Each stroke is a brush (tool, colour, size) plus a list of sample points: x and y in page coordinates, time, pressure and tilt, leaving out any value the device can't report. Platform formats, such as PencilKit's drawing data, are never stored. SVG and PNG are only ever generated from Foyer's strokes.

**Why:** The stored format is the one part of ink that's expensive to change, because changing it means converting every stroke ever drawn. Owning it keeps ink portable across iPad, phones, the web and future styluses, keeps the raw input that handwriting recognition needs, and lets the renderer change without migrating data. It holds while ink means handwriting, scribbles and doodles, where a "close enough" look across devices is fine; artistic brushes would need it revisited.

**Rejected:** PencilKit's drawing format, which is Apple-only, opaque and stores already-smoothed points. SVG as the stored format, which loses pressure, timing and stroke order, so strokes can't be redrawn with a better brush or recognised.

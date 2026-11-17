# What is a page?
Decided in #10, #16, #17 and #64

**Applies when:** building any view people write on, laying things out on a page, storing or syncing pages, positioning anything on a page, or deciding how people move around pages.

**Answer:** A paper-like sheet with a fixed shape, and the unit everything in Foyer happens on: calendar pages (month, week and day), notebook pages and items' body pages. A page never stretches, and it looks the same on every device, so ink and stickers land in the same place everywhere. A long note gets more pages.

Things on a page stack in the order they were added, as on paper: a scribble made after a sticker sits on top of it, and a sticker added after a scribble sits on top of the scribble. Moving something brings it to the top, like peeling it off and sticking it down again. The eraser only removes ink. Until #40 is built, ink is drawn above stickers and text.

- **Stacking order:** by when each thing was placed or last moved, by the device's clock, with equal times settled by id. A sticker keeps that time as `placed_at`, the time of the change that placed or moved it, and strokes and text store the same time, so stacking them together needs no conversion.

Pinch zooms within a page so people can write in detail. Moving between month, week and day pages has its own control. While zooming, everything on a page moves with it as one sheet, in every frame of a pinch, including while the view settles or bounces after it. On the iPad, the page and its ink are one zoomable sheet that iOS moves.

- **Size and unit:**
  - Pages follow paper sizes. Month and week pages are A2 landscape, 1683.78 × 1190.55 points, like a wall planner. Every other page is A4 portrait, 595.28 × 841.89 points.
  - Each page stores its own width and height, set when it's made and never changed. Another size, or landscape, can be offered later without converting anything (#77).
  - Positions are in points (1/72 of an inch) from the page's top-left corner, with y growing downwards. They are decimal numbers, and stored positions keep at least a hundredth of a point.
- **What a page belongs to,** which decides who sees it and its ink:
  - **Calendar pages:** every member of the household sees them (`who-can-see-what.md`).
  - **Space pages:** each space's main view, the Inbox included, holds the space's tasks as stickers. Each new task's sticker is placed below the last one and keeps its spot. When a page fills up, the space gets another. Only members who see the space see its pages.
  - **Item pages:** a task or event can have one body page, and a note has one or more, in the order they were added. They follow their item's space.
- **Ids:**
  - Calendar pages are named by their kind and date: `month:2026-11`, `week:2026-11-09` (by the week's first day) and `day:2026-11-14`. Dates are plain ISO 8601 dates, and each device works out "today" from its own clock and time zone.
  - Space pages are named by their space and number from 1: `space:<space id>:1`.
  - Item pages have UUID version 7 ids (`what-does-an-id-look-like.md`).
- **Storing and syncing:**
  - The household stores each page in its `pages` table: `id`, `kind` (`month`, `week`, `day`, `space` or `item`), `space_id` and `number` for space pages, `item_id` for item pages, `width`, `height`, `created_by` and `created_at`.
  - A device creates a page with `PageCreate` when it first puts something on it, so looking at an empty page creates nothing. Creating a page that already exists has no effect, so two devices that create the same calendar or space page offline write on one page.
  - Devices receive the pages they can see as `Page` (`how-do-devices-stay-in-sync.md`), and each page's ink when they open it.
  - An item's pages are in the order of their ids. Zoom and scroll position belong to each device and aren't stored.
  - Calendar pages are never deleted.

Month and week pages are built by #24.
Item pages are built by #23 and #29, which also decides how a note's page is deleted.

**Why:**
- Foyer should feel tangible, like a planner and a notebook. A fixed shape keeps scribbles in the same place on every device and at every zoom level, and the messy, layered look is part of the fun. Pinch belongs to writing, because writing on pages is central.
- Paper sizes and points keep handwriting at its real size on every device. Text is already sized in points, and PDF uses them, so exporting a page (#56) needs no conversion.
- A size stored with each page travels with it, so an older app still draws a page of a size added after it was built.
- Each page has one owner, so who sees it follows one rule, as for ink.
- Stacking by the device's clock follows the order things were put down in real life, even on a device that was offline, and it's the time sync already keeps to settle conflicts.
- Every device can name a calendar or space page without asking the household, so writing on the same day offline, or adding tasks to the same space, lands on one page rather than two copies.
- When the page and its ink were separate views on the iPad, they drifted apart while iOS animated the zoom (#2).

**Rejected:**
- An infinite canvas, where people get lost. Pages that grow to fit their content, which would move ink out of place. Pinching to move between month, week and day, which clashes with zooming in to write.
- A3 for month and week pages, where a month's day is about 60 × 45 mm. A2 for month pages and A3 for week pages.
- Millimetres, which need converting for text sizes and PDF. A range from 0 to 1 across the page, which would stretch ink on pages of another shape. Screen pixels, which differ between devices.
- Storing a size's name, such as `A4`, which an older app couldn't draw once a new size is added.
- Loose pages in a space, attached to no item, which would be another kind of thing with rules of their own.
- Tasks on a space's page laid out as a list drawn in order, where ink would no longer line up with its task once tasks are added, ticked or reordered.
- For stacking: the household's change numbers, which put everything made offline on top once it syncs; and a separate layer number, which two devices offline could both claim.
- UUIDs for calendar and space pages, where two devices offline would each create their own copy of the same page.

# What is a sticker?
Decided in #10, #17, #130 and #80

**Applies when:** showing an item on a page, placing, moving or removing stickers, storing or syncing them, deciding what tapping or ticking something on a page does, or showing a page to someone who can't see everything on it.

**Answer:** Something stuck on a page. Most stickers are links to an item (a task, event or note) that lives in its space, and the same item can appear as stickers on several pages. A task sticker shows its title and a checkbox you can tick right on the page; a note sticker shows a thumbnail of the note. Tapping a sticker opens the item's full view. Decorative stickers, such as images or emoji, are the exception: they're only pictures.

Someone who can't see an item still sees its sticker, in the same spot and with the same shape, but with its contents hidden (for example greyed out or scribbled over). It is never labelled "private".

- **Shape:** each kind of sticker has a fixed size, set in the apps' code, so a sticker stores its kind but not its size.
  - A device that can't see the item still draws the right shape. Turning an item into another kind changes its stickers' kind.
  - Contents fit the sticker: a long title wraps or is cut short.
  - Sizes can differ by kind of page and can change in the design milestone. Existing stickers then take the new size and keep their top-left corner.
  - An app that doesn't know a kind yet draws a plain outline of a default size.
- **Stacking:** things on a page stack by when they were placed or last moved, by the device's clock, with equal times settled by id (`what-is-a-page.md`).
- **Fields,** in the household's `stickers` table: `id`, a UUID version 7 made by the device that places it; `page_id`; `x` and `y`, its top-left corner in points from the page's top-left; `kind`, `task`, `event` or `note`; `item_id`; `placed_at` and `placed_by`, the time and member of the change that placed or last moved it. Removed stickers stay as tombstones (`how-do-devices-stay-in-sync.md`).
- **Changes:**
  - `StickerPlace {sticker_id, page_id, x, y, kind, item_id}`, on a page that has been created, with its top-left corner on the page and its kind its item's.
  - `StickerMove {sticker_id, x, y}`, within its page. The move made last wins, by the device's clock, and brings the sticker to the top.
  - `StickerRemove {sticker_id}` peels it off. Removing an item's sticker never deletes the item. A task's sticker stays on its own space's page, or on its parent's body page when it's under another item, until the task is deleted, moved to another space or put somewhere else, because those pages are its list (`can-items-hold-other-items.md`).
- **Who can do what:** everyone who can see a page sees all its stickers. Only someone who can see a sticker's item can place, move or remove it, so on a calendar page nobody can reschedule what they can't see.
- **Placing automatically:** when an item joins a space, its device places the sticker in the next free spot on a page: at the left margin, below the lowest sticker on the page. Each kind of page sets its own rules on top.

Stickers on calendar pages are built by #27, and on notes' pages by #31.

**Why:** One object shown in many places, with its source of truth elsewhere, keeps every view consistent: ticking a task anywhere ticks it everywhere. Hidden stickers keep the page identical for everyone, so shared scribbles stay next to the right sticker, and hiding them playfully fits Foyer better than a formal label. A size set by kind lets the design change it without converting stickers, and the kind stored with each sticker lets a device that can't see the item still draw its shape.

**Rejected:**
- For hidden stickers: leaving a gap, which looks unexplained, or a "private" label, which feels too serious.
- Storing each sticker's width and height, which would keep exact shapes when sizes change.
- Peeling a task's sticker off its own space's page, with a way to put it back from the space's list. It needs a part of the list that the pages don't explain.

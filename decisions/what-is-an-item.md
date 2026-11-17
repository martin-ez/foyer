# What is an item?
Decided in #21 and #129

**Applies when:** storing, syncing or changing tasks, events or notes, adding a field or a kind of item, or turning an item into another kind.

**Answer:** A task, an event or a note. Every item lives in one space, which decides who sees and changes it (`who-can-see-what.md`), and can appear as stickers on several pages (`what-is-a-sticker.md`).

- **One table for every kind:** tasks, notes and events are stored in the household's one `items` table, each with its `kind`. Fields only one kind uses are empty for the others.
- **Fields shared by every kind:**
  - `id`: a UUID version 7, made by the device that creates it (`what-does-an-id-look-like.md`).
  - `kind`: `task`, `event` or `note`.
  - `space_id`: the space it lives in.
  - `title`: trimmed, never blank, and at most 500 characters, counted as Unicode code points. The household refuses a change that breaks either rule.
  - `description`: plain text, or empty, and at most 10,000 characters, counted as Unicode code points. Longer writing belongs in a note.
  - `date`: an optional day, as a plain ISO 8601 date with no time and no time zone.
  - `created_by` and `created_at`.
- **Changes to each field never conflict with changes to another:** each field that can change keeps the time and the id of the change that last set it, and the change made last wins for each field (`how-do-devices-stay-in-sync.md`).
- **Changes,** each by anyone who can see the item's space:
  - `ItemCreate {item_id, kind, space_id, title, description, date}`, in a space the member sees. A device pushes it with the item's sticker on its space's page, and the page when the sticker starts one, in the same push.
  - `ItemSetTitle {item_id, title}`, `ItemSetDescription {item_id, description}` and `ItemSetDate {item_id, date}`, where an empty date clears it.
  - `ItemMove {item_id, space_id}`, to a space the member also sees. The device takes the item's sticker off the old space's pages and puts one on the new space's newest page, in the same push. Its stickers on other pages stay. Members who can't see the new space receive the item as deleted.
  - `ItemDelete {item_id}` leaves a tombstone, and the household removes the item's stickers on every page with it, so none is left pointing at nothing.
- Devices receive the items they can see as `Item {id, kind, space_id, title, description, date, created_by, created_at}`.

Events and notes are created from #26 and #29.

**Why:** Turning an item into another kind (#52) changes only its `kind`, so its id, stickers, children and body page stay. Per-field times let two people edit different fields of the same item offline without one undoing the other.

**Rejected:**
- A table per kind, where turning one into another would copy it under a new id and move its stickers, children and pages.
- No limit on descriptions, where a very long one fails to save with an unclear reason.

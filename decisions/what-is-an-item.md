# What is an item?
Decided in #21, #129, #59, #80, #26 and #28

**Applies when:** storing, syncing or changing tasks, events or notes, adding a field or a kind of item, or turning an item into another kind.

**Answer:** A task, an event or a note. Every item lives in one space, which decides who sees and changes it (`who-can-see-what.md`), and can appear as stickers on several pages (`what-is-a-sticker.md`).

- **One table for every kind:** tasks, notes and events are stored in the household's one `items` table, each with its `kind`. Fields only one kind uses are empty for the others.
- **Fields shared by every kind:**
  - `id`: a UUID version 7, made by the device that creates it (`what-does-an-id-look-like.md`).
  - `kind`: `task`, `event` or `note`.
  - `space_id`: the space it lives in.
  - `title`: trimmed, never blank, and at most 500 characters, counted as Unicode code points. The household refuses a change that breaks either rule.
  - `description`: plain text, or empty, and at most 10,000 characters, counted as Unicode code points. Longer writing belongs in a note.
  - `date`: an optional day, as a plain ISO 8601 date with no time and no time zone. An event's is the day it starts in its Google calendar's time zone, which only the household sets (`how-are-dates-and-times-stored.md`).
  - `created_by` and `created_at`. An event added in Google Calendar has no `created_by`, and Google's time as `created_at`.
- **Nesting:** `parent_id`, the task or note the item is under, or empty at the top of its space (`can-items-hold-other-items.md`).
- **Fields only tasks use:** `repeat`, the rule a repeating task follows, and `repeat_from`, where its next date comes from, both empty for a task that doesn't repeat (`how-do-tasks-work.md`). A repeating task always has a date.
  - `time`: an optional time of day, with no duration, as an ISO 8601 local time of hours and minutes with no time zone, such as `19:00` (`how-are-dates-and-times-stored.md`). Only a task with a date has one, and clearing the date clears it. It keeps the change that last set it in `time_at` and `time_change_id`, as an event's time does, and clearing the date counts as setting it, so an earlier time sent afterwards has no effect.
- **Fields only events use:** when the event happens, with exactly one of two pairs set: `starts_on` and `ends_on`, plain dates for an all-day event, where `ends_on` is its last day, or `starts_at` and `ends_at`, instants for an event with times. An event never ends before it starts. Its time changes as one value, so it keeps one time and change id (`time_at`, `time_change_id`) for all four.
- **Changes to each field never conflict with changes to another:** each field that can change keeps the time and the id of the change that last set it, and the change made last wins for each field (`how-do-devices-stay-in-sync.md`).
- **Changes,** each by anyone who can see the item's space:
  - `ItemCreate {item_id, kind, space_id, title, description, date, starts_on, ends_on, starts_at, ends_at}`, in a space the member sees. A device pushes a task with its sticker on its space's page, and the page when the sticker starts one, in the same push. The time fields are required for an event and refused for any other kind, and an event's date must be empty. An event can only be created in a space with a Google calendar (`calendar_state` not `none`), so never in the Inbox.
  - `ItemSetTitle {item_id, title}`, `ItemSetDescription {item_id, description}` and `ItemSetDate {item_id, date}`, where an empty date clears it, except a repeating task's. `ItemSetDate` is refused on an event.
  - `EventSetTime {item_id, starts_on, ends_on, starts_at, ends_at}` changes when an event happens, as one value, and its date with it.
  - `ItemSetRepeat {item_id, repeat, repeat_from}`, on a task, where an empty rule stops it repeating.
  - `ItemSetTime {item_id, time}`, on a task, where an empty time clears it. A time is refused on a task without a date, and on events and notes.
  - `ItemSetParent {item_id, parent_id}`, where an empty parent puts the item back at the top of its space (`can-items-hold-other-items.md`).
  - `ItemMove {item_id, space_id}`, to a space the member also sees, with everything under the item. Events, the item or any under it, can only move to a space with a Google calendar, and take the day they start in its time zone. The device takes the item's sticker off the old space's pages and puts one on the new space's newest page, in the same push. Its stickers on other pages stay. Members who can't see the new space receive the item as deleted.
  - `ItemDelete {item_id}` leaves a tombstone, and the household removes the item's stickers on every page with it, so none is left pointing at nothing.
- Devices receive the items they can see as `Item {id, kind, space_id, title, description, date, created_by, created_at, repeat, repeat_from, parent_id, starts_on, ends_on, starts_at, ends_at, time}`.

Notes are created from #29.

**Why:** Turning an item into another kind (#52) changes only its `kind`, so its id, stickers, children and body page stay. Per-field times let two people edit different fields of the same item offline without one undoing the other.

**Rejected:**
- A table per kind, where turning one into another would copy it under a new id and move its stickers, children and pages.
- No limit on descriptions, where a very long one fails to save with an unclear reason.

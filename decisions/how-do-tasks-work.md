# How do tasks work?
Decided in #10, #21, #23 and #59

**Applies when:** capturing, completing, repeating or showing tasks.

**Answer:**
- **Capture:** quick capture always creates a task, in the capturer's private Inbox. Later it's sorted into a space and given a date, or turned into another kind of item (a note or an event), keeping what they share: title, description and page. Tasks don't need a date.
- **Title and date:** a task's title can't be blank, and is at most 500 characters. A date is a day with no time; a time of day comes with the day timeline (#28) and reminders (#35).
- **Space pages:** each space's main view is its page, the Inbox included, with its tasks as stickers. Each new task's sticker goes in the next free spot below the last one, and keeps its spot. When the next sticker doesn't fit, it goes on the space's next page. Tasks on a full page stay where they are, ticked and open, with the scribbles next to them, like a filled notebook. A space opens on its newest page, with a toggle to its list.
- **A space's list follows its pages:** tasks are in sticker order, page by page, top to bottom, then left to right. Moving a sticker on the page reorders the list. Nothing extra is stored.
- **Today** lists the tasks dated today or earlier, overdue first, then in their space's page order. "Today" is the device's own date. It shows only open tasks.
- **Ticking:** every tick adds a completion record, whether or not the task repeats. A task is done when it has a completion for its current occurrence; for a task that doesn't repeat, that's any completion.
  - A completion is stored in the household's `completions` table: `id`, a UUID version 7 made by the device that ticks; `item_id`; `occurrence`, the date of the occurrence it completes, empty for a task that doesn't repeat; `done_at`, the tick's time by the device's clock; and `done_by`.
  - `TaskTick {completion_id, item_id, occurrence}` adds a completion. If the occurrence already has one, nothing changes. `TaskUntick {item_id, occurrence}` removes it, leaving a tombstone.
  - A tick and an untick of the same occurrence settle by when they were made: the one made last wins, by the device's clock.
  - Anyone who can see a task can tick or untick it, whoever ticked it.
  - Devices receive completions as `Completion {id, item_id, occurrence, done_at, done_by}`. They belong to their task's space, so they reach the same members, move with the task and are deleted with it.
  - A ticked task stays on the page, shown as done. Lists hide ticked tasks, with a "Show done" toggle that each device keeps for itself, unsynced. Today shows only open tasks.
- **Repeating:** a repeating task is one task with a repeat rule, as in Todoist. Ticking it marks that occurrence as done and moves the task to its next date. Each completion is kept as its own record (the task, the date it was done and who ticked it), and the sticker on that day shows that occurrence as done.

Repeating tasks, and the occurrences they tick, are built by #59.

**Why:** Capture has to be as fast as Todoist's, so it can't ask what kind of item something is; sorting later, as in Getting Things Done, keeps it instant. Seeing finished work stay on the page is satisfying, and visible progress is part of designing Foyer like a game whose goal is an organised household. Repeating chores are table stakes for replacing Todoist: one task that moves forward keeps lists short, and completion records keep the history of what got done. One way of ticking every task, repeating or not, keeps that history for all of them. Anyone can untick a task, as anyone can edit what's in a space they see (`who-can-see-what.md`). Lists hide ticked tasks, as Todoist's do, so they show what's left to do, while the page keeps the record.

**Rejected:** Capturing plain text and deciding its type later, which adds a decision to every item. Ticked tasks disappearing from the page. `done_at` and `done_by` fields on the task, which would leave two ways of ticking once tasks repeat. Only the person who ticked a task unticking it. Keeping ticked tasks in lists, crossed out, or moving them to a "Done" group at the end. A separate task for every occurrence of a repeating task, which fills lists with copies. Carrying open tasks over to a space's new page, which leaves the ink written next to them behind; and clearing ticked tasks off a full page. A list order stored apart from the page, and sorting a space's list by date.

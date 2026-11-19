# What does a sticker's position mean?
Decided in #10, #27 and #28

**Applies when:** placing, moving or laying out stickers on any page.

**Answer:**
- **Calendar pages:** position means date. An item appears on its day, and sticking an item on a day gives it that date. Moving a sticker to another day asks "Did you mean to change the date?"; declining puts it back.
- **Day page:** height also means time, with snapping. Moving a sticker up or down changes its time without asking. Items with a date but no time sit apart from the timeline, in a strip at the top of the page.
- **Month and week pages:** position within a day has no time meaning.
- **Free pages** (notebook and body pages): position means nothing; a sticker is a reference placed by hand.

Each sticker has a fixed spot on its page, the same for everyone. New stickers are placed automatically and can be moved within their day. Placing new stickers around the ink already on a day isn't built yet: #148.

- **Which calendar pages:** a dated task or event has a sticker on each calendar page that shows its day: its month's, its week's and its day's, each with its own spot. An event's day is the one it starts on in its calendar's time zone (`how-are-dates-and-times-stored.md`); one over several days has its stickers on its first day. Repeating events wait for #60.
- **Its day:** each sticker on a calendar page stores the day it's on as `occurrence` (`what-is-a-sticker.md`), so a repeating task can have stickers on the days it was ticked as well as on its next date.
- **Adding from a day:** tapping an empty spot in a day offers a new task, a new event, or one of the member's open tasks without a date. A new one asks for its space, starting on the last space they picked from the calendar, which each device keeps for itself, unsynced. Events offer only spaces with a Google calendar. The sticker goes where they tapped, inside the day, and the item takes that day as its date.
- **Placing automatically,** for now: a new sticker goes in the next free spot of its day's box, at its left edge, below the lowest sticker on that day. When the box is full, it goes on the lowest one, a little lower, like a pile. Every sticker on a calendar page has the same size, small enough for a few to fit in a month's day.
- **Moving by hand:** within its day, a sticker just moves, and stays inside the day's box. Dropped on another day of the same page, it asks first: yes changes the item's date, keeps the sticker where it was dropped, and moves the item's stickers on its other calendar pages to the new day's next free spot; an event keeps its times and length. No puts it back, and so does dropping it outside any day.
- **When the date changes elsewhere,** in an editor, by a tick, or in Google, the item's calendar stickers move to the new day's next free spot: on the same page when it shows the new day, and onto the new day's page otherwise. Clearing a task's date takes them off.
- **Ticked tasks** stay on every page, shown as done. Ticking a repeating task leaves its stickers on the day ticked, shown as done for that occurrence, and places new ones on its next date. Unticking it removes those.
- **The day page's timeline:** a sticker's top edge is at its item's time: a task's time (`what-is-an-item.md`), or when an event starts, on each device in its own time zone (`how-are-dates-and-times-stored.md`). A height turns into a time by where it falls between the timeline's first and last hours, snapped to the nearest step; earlier or later times sit at its ends. Its hours and step are a wireframe, set with the day page's layout in `@foyer/shared`.
  - Dropping a task's sticker on the timeline sets its time, and in the strip clears it. Dropping an event's moves its start there and keeps its length; in the strip, it happens all day; and an all-day event put on the timeline lasts an hour, as in Google Calendar. Tapping an empty spot on the timeline adds something at that time.
  - An event with times shows how long it lasts, down the timeline, to members who can see it. Its sticker keeps the same shape for everyone, so a hidden event's length isn't shown.
  - Stickers placed automatically on the timeline go at their time, in the first column right of the hours where they cover no other sticker; those without a time go in the strip's next free spot. When an item's time changes elsewhere, its sticker on the day page moves to the new time, or into the strip.
- **Who places them:** the device that gives an item a date, or changes it, places or moves its calendar stickers in the same push, so they show at once, offline too. After each push, and after Google's changes, the household makes sure every item they changed has one sticker on its day on each kind of calendar page, and at its time on the day page, an event's in its calendar's time zone, moving or placing them as above, so a change that lost a conflict, or an event that starts on another day in its calendar's time zone, ends up right. Placing lives in `@foyer/shared`, so both follow the same rule.

**Why:** Moving a sticker should feel like rescheduling on paper, and a day page like a planner's, where how far down something is says when it happens. Fixed spots keep the page identical for everyone, so shared scribbles stay next to the sticker they're about. Every board shows every dated item, so scribbles can sit next to it on any of them. A device places stickers itself so dating something offline shows on the calendar at once; the household checks afterwards because only it knows how conflicts settled and what day an event starts on in its calendar's time zone.

**Rejected:**
- Stickers arranged separately for each person, where shared scribbles can end up next to the wrong sticker.
- Calendar stickers on week and day pages only, or on day pages only.
- New tasks from a day always going to the Inbox, and a household's default space, which nothing stores.
- Dropping the idea of placing around ink, and waiting for ink (#18) before building calendar stickers.

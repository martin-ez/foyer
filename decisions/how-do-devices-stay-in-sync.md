# How do devices stay in sync with the household?
Decided in #14 and #21

**Applies when:** storing, changing or deleting anything devices hold, adding a kind of change or of row to sync, deciding which devices receive something, or changing how devices connect, catch up or send their changes.

**Answer:**
- **The household stores the current version of everything, each row stamped with the number of its last change.**
  - Devices send changes, such as `SpaceRename`, each with an id the device makes, a UUID version 7 (`what-does-an-id-look-like.md`).
  - The household applies each change to the rows it affects and gives it the next number in its one sequence, kept in the `household` table. Each row keeps that number as `seq`. A change that loses a conflict gets a number too. A refused change gets none.
  - A deleted row leaves a tombstone in `tombstones`: its kind, its id, its `seq` and who could see it (`visible_to`, empty for every member), without its contents.
  - A row that moves out of a member's sight, such as a task moved from a shared space to someone's Inbox, leaves a row in `hidden_rows` for each member who could see it before and can't now: its kind, its id, the member and the move's `seq`. Each member receives theirs as the row deleted. Moving it back where they see it sends them the row again and removes their hidden rows for it.
  - The household remembers what became of each change, by its id, for 90 days, as long as an unused session lasts, in `changes`. A change sent again is answered as it was the first time, and has no further effect.
  - Catching up sends the current version of every row changed after the device's cursor, not the changes that led there.
- **The change made last wins, by the device's clock.**
  - Each change carries `at`: when the person made it, by their device's clock. The household keeps that time and the change's id next to each value it sets, such as a space's `name_at` and `name_change_id`. A change only replaces a value if its `at` is later. Equal times are settled by the larger change id.
  - Changes to different values never conflict.
  - An `at` later than the household's clock counts as the household's time, so a device whose clock runs fast can't win forever.
- **What each device receives:** everything its member can see except ink, plus the ink of the pages it opens. On connecting, it catches up from its cursor. While connected, it receives every change it can see as soon as the change is committed, its own included.
- **Who receives what:** each row belongs to a space, or to the household, as members do. The household's rows go to every member, and a space's rows to the members who can see the space (`who-can-see-what.md`). Members never learn of changes in spaces they can't see. Stickers belong to their page, not to their item (`what-is-a-sticker.md`).
- **Refused changes:** the household refuses a change it can't apply, such as renaming someone else's personal space, and says why in a sentence. The device undoes the change, drops it, and says it couldn't be saved. A change that loses a conflict isn't refused: it's committed with no effect, and the device that made it receives the row as it now is.
- **The connection** is a WebSocket at `/sync`, which carries the session as calls do (`how-do-people-sign-in.md`). The Worker checks the session before the connection reaches the household, and takes the web app's cookie only from the backend's own site.
  - Each binary WebSocket message is one Protocol Buffers message from `foyer.sync.v1`. A device sends `Push {push_id, changes[]}` and `Pull {cursor}`. The household sends `Welcome {seq}` when the connection opens, `Updates {rows[]}`, `Committed {push_id, results[]}` after a push's updates, and `PullReply {rows[], cursor, done}`.
  - A pull reply holds at most 500 rows, and never splits the rows of one change. The device pulls again from the reply's cursor until it's done.
  - The text "ping" is answered with "pong" by the runtime, which costs no requests. Devices send it every 30 seconds, and connect again after 75 seconds without hearing anything.
  - The same connection carries the live lane, which tells devices who is on which page and where they point (`what-does-the-live-lane-send.md`).
  - When a session ends, the household closes its connections with code 4401, and the device stops connecting until someone signs in. After any other drop, the device connects again, waiting longer after each failed attempt, up to 30 seconds. It catches up from its cursor and sends its unsaved changes again, as the same changes.
- **What devices store:** what they receive, in memory. They catch up in full when the app starts.

Pulling a page's ink, from a cursor for each page, is built by #18.
Keeping what the iPad receives between launches is built by #20.

**Why:**
- Catching up grows with what exists, not with everything ever done, and a new device downloads the household as it is now.
- Storage holds no history. Ink is most of it: about 1.75 GB per busy household over five years (#4), against 5 GB for the whole account.
- An edit made offline on Monday and synced on Wednesday doesn't overwrite one made on Tuesday.
- Ink is most of the data. Everything else is small enough for every device to hold, so lists, search and capture work offline.
- Connections drop in bursts with no fault on the server (#4), so every device must connect again and pull from its cursor.
- Sending a whole day's changes in one reply took 7 ms of CPU against a 10 ms limit (#4), so replies are capped.
- A device whose session has ended can't send changes again, so remembering changes for longer than a session lasts unused is useless.

**Rejected:**
- A log of every change, replayed on catching up. It keeps history for free, but it grows forever and a new device replays everything ever done.
- The change that arrives last wins. It needs no stored times, but a late offline edit overwrites newer ones.
- Every device holding the whole household, ink included, which grows by gigabytes over the years.

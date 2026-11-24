# How do devices stay in sync with the household?
Decided in #14, #21, #25, #26, #151, #147, #107, #18, #20 and #89

**Applies when:** storing, changing or deleting anything devices hold, adding a kind of change or of row to sync, making something people do send several changes, deciding which devices receive something, or changing how devices connect, catch up or send their changes.

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
  - Changes the household makes itself, such as those it reads from Google Calendar, are settled the same way, with the time they were made there (`where-do-calendar-events-live.md`).
- **What each device receives:** everything its member can see except ink, plus the ink of the pages it opens and, on the iPad, of the pages it keeps. On connecting, it catches up from its cursor. While connected, it receives every change it can see as soon as the change is committed, its own included.
- **A page's ink:** a device pulls it on opening the page, from a cursor it keeps for that page, with `Pull {cursor, page_id}`.
  - The reply holds the page's strokes added or erased after the cursor, erased ones as deleted rows of `ROW_KIND_STROKE`, and repeats `page_id`. A pull without `page_id` never includes ink.
  - The device pulls again from the reply's cursor until it's done. A reply holds at most 500 strokes and 512 KB of samples, unless one change alone changed more, and never splits the strokes of one change.
  - Pulling a page's ink makes it the page the connection follows, until the device pulls another page's ink or the connection closes. The household keeps it in memory with the connection, and sends it the page's new and erased strokes as `Updates`, as they're committed, its own included.
  - A pull for a page the member doesn't see returns no rows and says it's done.
- **Who receives what:** each row belongs to a space, to the household, as members do, or to one member, as their Google connection does. The household's rows go to every member, a space's rows to the members who can see the space (`who-can-see-what.md`), and a member's own rows to them alone. Members never learn of changes in spaces they can't see. Stickers belong to their page, not to their item (`what-is-a-sticker.md`).
- **Refused changes:** the household refuses a change it can't apply, such as renaming someone else's personal space, and says why in a sentence. The device undoes the change, drops it, and says it couldn't be saved. A change that loses a conflict isn't refused: it's committed with no effect, and the device that made it receives the row as it now is.
- **Actions:** the changes a device makes together for one action, such as putting a task under another, which sets its parent and moves its sticker, stand or fall together.
  - They share an `action_id`, a UUID version 7 the device makes. A change made alone has none.
  - The device sends an action's changes one after another in one push, in the order it made them, never split between pushes.
  - A push holds at most 10 changes, unless one action alone has more: it goes whole, in a push of its own.
  - The household applies them in one transaction, in that order. If one is refused, none is applied, and each is answered as refused with that one's reason. Committed, each gets its own number.
  - A change that loses a conflict isn't refused, so it doesn't undo the rest of its action.
  - Each change is remembered by its id, as any change is, so an action sent again is answered as it was the first time.
  - The device undoes a refused action whole, and says once that it couldn't be saved.
- **The connection** is a WebSocket at `/sync`, which carries the session as calls do (`how-do-people-sign-in.md`). The Worker checks the session before the connection reaches the household, and takes the web app's cookie only from the backend's own site.
  - Each binary WebSocket message is one Protocol Buffers message from `foyer.sync.v1`. A device sends `Push {push_id, changes[]}` and `Pull {cursor}`. The household sends `Welcome {seq}` when the connection opens, `Updates {rows[]}`, `Committed {push_id, results[]}` after a push's updates, and `PullReply {rows[], cursor, done}`.
  - A pull reply holds at most 500 rows, and never splits the rows of one change. The device pulls again from the reply's cursor until it's done.
  - The text "ping" is answered with "pong" by the runtime, which costs no requests. Devices send it every 30 seconds, and connect again after 75 seconds without hearing anything.
  - The same connection carries the live lane, which tells devices who is on which page and where they point (`what-does-the-live-lane-send.md`).
  - When a session ends, the household closes its connections with code 4401, and the device stops connecting until someone signs in. After any other drop, the device connects again, waiting longer after each failed attempt, up to 30 seconds. It catches up from its cursor and sends its unsaved changes again, as the same changes.
- **What the web app stores:** what it receives, in memory, so it catches up in full when it opens.
  - It also keeps its member's unsent changes in the browser's IndexedDB, encoded as they're sent, and nothing else. A change is kept when it's made, and forgotten once the household commits or refuses it.
  - When the web app next opens and connects, it sends them again, as the same changes, before anything new, with each action's changes together. A change kept by two tabs is applied once, since the household answers a change sent again as it did the first time.
  - They're kept for the member who made them, and forgotten when the member signs out or the household ends their session. Another member signing in on the same browser never sends them.
- **What the iPad stores:** a copy of what it receives, in a SQLite database of the signed-in member's own, with Expo's `expo-sqlite`.
  - It holds the rows the household sends, with the strokes of the pages it keeps, the changes not yet committed, the household's cursor and each kept page's cursor.
  - At launch, the iPad reads it, then catches up from its cursor instead of downloading everything again.
  - It's only a copy: if an app update changes its layout, the app rebuilds it from the household. Unsent changes are kept as encoded changes, so a rebuild never loses them.
  - Signing out deletes it. The household ending the session deletes all of it but the member's unsent changes, which the iPad sends once the same member signs in again, and deletes if someone else signs in first (`how-do-people-sign-in.md`).
- **Which pages' ink the iPad keeps:** this month's month page; this week's and next week's week pages and their day pages; each space's newest page; and the 30 pages opened most recently on this iPad.
  - When a page drops out of the set, its strokes are deleted from the iPad, except those still waiting to be sent.
  - When a page was last opened is kept only on the iPad, and never synced.
  - While online, the iPad pulls each kept page's ink on catching up, from that page's cursor.
- **Offline on the iPad:** pages whose ink it keeps open, and can be written on and erased. Stickers can be placed and moved, and items changed, anywhere, since that data is all on the iPad. Everything queues and syncs when the connection returns. Typed text stays read-only.
  - A page whose ink the iPad doesn't keep can't be opened offline. The app says it isn't on this iPad and opens it once back online, so nobody writes over ink they can't see.

The web app pulling a page's ink when it opens is built by #19.
The iPad receiving new strokes on every kept page as they're committed, not only on the page it shows, is built by #256.

**Why:**
- Catching up grows with what exists, not with everything ever done, and a new device downloads the household as it is now.
- Storage holds no history. Ink is most of it: about 1.75 GB per busy household over five years (#4), against 5 GB for the whole account.
- An edit made offline on Monday and synced on Wednesday doesn't overwrite one made on Tuesday.
- Ink is most of the data. Everything else is small enough for every device to hold, so lists, search and capture work offline.
- Pulling a page's ink is the same loop as pulling the household, from a cursor of its own. Following the page last pulled keeps ink apart from presence, which drops a device after a minute of silence (`what-does-the-live-lane-send.md`). A WebSocket message must stay under 1 MB, and a long stroke can take tens of kilobytes.
- Connections drop in bursts with no fault on the server (#4), so every device must connect again and pull from its cursor.
- Sending a whole day's changes in one reply took 7 ms of CPU against a 10 ms limit (#4), so replies are capped.
- Applying changes costs far more CPU than sending them: on the preview, a push of 100 changes took 30 to 230 ms, and one of 10 changes 5 to 26 ms (#107). Cloudflare only tolerates going over 10 ms now and then, and a device back from a long time offline sends its pushes one after another, so pushes are small.
- A device whose session has ended can't send changes again, so remembering changes for longer than a session lasts unused is useless.
- A change made on a phone while offline, such as a captured task, would be lost if the tab closed before the connection came back (#147). Only unsent changes exist nowhere else: what a device received comes back when it catches up.
- An action applied in part leaves things half done, such as a task under another with its sticker still on its space's page (#151). Refusing it whole leaves things as they were before, on every device.
- The iPad is where people write, and it has to work without a connection (#20). The current calendar and the pages in use are where people write next, and a fixed set of pages keeps the ink it holds from growing with use.
- SQLite writes only the rows that change, where a file is written whole and gets slow once a page holds thousands of strokes.
- Writing on a page whose ink the iPad doesn't hold would put new ink over ink nobody there can see.

**Rejected:**
- A log of every change, replayed on catching up. It keeps history for free, but it grows forever and a new device replays everything ever done.
- The change that arrives last wins. It needs no stored times, but a late offline edit overwrites newer ones.
- Every device holding the whole household, ink included, which grows by gigabytes over the years.
- Separate messages for pulling a page's ink, which are clearer to read but add a second pull loop to every device.
- Sending a page's new ink to the devices the live lane says are on it, which ties ink to presence.
- Applying each change of an action on its own, and having devices notice and fix what a refused change left half done. Every action would need its own repair.
- Having the household move a task's sticker itself when it moves the task. It fixes stickers only, and not other actions made of several changes.
- Keeping the iPad's copy in files of JSON, which are written whole and get slow once a page holds thousands of strokes.
- Keeping the ink of every page opened in the last 30 days, which grows with use; and of calendar pages only, which leaves notes and space pages needing a connection.
- Opening a page the iPad doesn't keep blank while offline and letting people write on it, with others' ink appearing later.

# What do devices tell each other live, and how often?
Decided in #15 and #58

**Applies when:** sending anything short-lived between devices that isn't stored, such as who is on a page, where they point, text locks, live sticker drags or live strokes; or changing how often devices send it, who receives it, or the live lane's daily limit.

**Answer:**
- **The live lane** carries short-lived state over the sync connection (`how-do-devices-stay-in-sync.md`), as Protocol Buffers messages in `foyer.sync.v1`, in `live.proto`. The household keeps it in memory with each connection, which survives the household sleeping, and never stores it. After a restart, devices send `Enter` again when they connect again.
- **From a device:**
  - `Enter {page_id}`: this device is now on that page. Sent on opening a page, and again on returning from the background or connecting again.
  - `Leave {}`: this device left its page, or went to the background.
  - `Point {x, y}`: where this device is pointing on its page, in page coordinates (`what-is-a-page.md`). Sent only while the household says someone else is on the page, and only while the pointer moves, at most 4 times a second, with the latest position last.
- **From the household:**
  - `Here {page_id, members[]}`: the other members on the page, sent to every device on it whenever someone enters or leaves. Each member is listed once, with where they last pointed from whichever of their devices pointed last, or no position before they point. A device never gets its own member back.
  - `Pointed {member_id, x, y}`: a `Point` passed on to the other members' devices on the same page. The household drops positions a device sends faster than 4 a second.
  - `LiveLimit {}`: the day's limit for positions is reached. Sent to every device when the limit is reached, and to a device that enters a page or points while it is.
- **Who receives it:** only members who can see the page (`who-can-see-what.md`), whether or not anything has been put on it yet. A device that enters a page its member can't see is on no page, and nobody is told. Nobody learns that someone is on a page they can't see.
- **Lost connections:** a device the household hasn't heard from for a minute, by a message or by the keep-alive "ping", is taken off its page, and the others get a new `Here`. The household closes its connection, so a device that's still there connects again and enters again.
- **Daily limit:** every position a device sends counts. At a third of the free plan's 100,000 daily requests, 33,333 positions, the household stops passing positions on and leaves them out of `Here` until midnight UTC, when the plan's count starts again. Devices stop sending positions until then, and others' markers wait at the page's edge. `Enter` and `Leave` keep working. The day's count is stored, so that the limit holds while the household sleeps; nothing else on the live lane is.

Markers showing where others point are built by #58.

**Why:**
- Each message a device sends counts as one request against the free plan's 100,000 a day, shared with the preview. Messages the household sends, and the keep-alive the runtime answers, cost nothing (#4). At 4 positions a second, two people both moving on the same page for a whole hour use about 29% of a day's requests, and ten minutes a day about 5%.
- A device alone on a page, or whose pointer is still, sends no positions, so requests are only spent when someone can see them.
- 4 positions a second, with markers gliding between them, looks live without using up the day's requests (#58).
- After a dropped connection, the household can keep listing the dead connection (#4), so who is on a page depends on hearing from each device, not on its connection looking open.
- Keeping each device's state with its connection survives the household sleeping between messages. Storing it would cost a write for something that's out of date within a second.

**Rejected:**
- 10 positions a second, which would use the free plan's requests too fast, and once a second, which makes markers jump (#58).
- Counting open connections to tell who is on a page, which overstates it after dropped connections (#4).
- Storing who is on which page, or where they point.
- Keeping the day's count of positions only in memory, which the household loses whenever it sleeps.

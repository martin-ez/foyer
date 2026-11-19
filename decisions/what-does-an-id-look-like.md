# What does an id look like?
Decided in #54, #106

**Applies when:** giving anything that is stored or sent an id, or reading, comparing or sorting ids.

**Answer:**
- **Every id in Foyer is a UUID version 7, written as a lowercase string**, such as `019a8f4e-5c00-7a3b-8c4d-1e2f3a4b5c6d`. `newId()` in `@foyer/shared` makes one, on the Worker and in the apps.
- **Whoever creates a thing makes its id.** The server makes members' ids. Devices make the ids of what they create, such as tasks and strokes, even offline.
- **Calendar and space pages are the exception.** They're named by their date or their space, such as `day:2026-11-14` or `space:<space id>:1`, so every device agrees on them offline (`what-is-a-page.md`).
- Ids sort by when they were made, by the clock of whoever made them, to the millisecond.
- **Ids from one device sort in the order they were made, even within a millisecond.** An id made in the same millisecond as the last one, or after the device's clock went back, keeps the last id's time and adds one to its random bits, as RFC 9562's monotonic random method does.

**Why:**
- Unique without asking the server, so devices can create things offline and resend them safely.
- Ordered by creation time, so SQLite indexes stay compact and ids sort by when things were made.
- When two changes set a value at the same time, the household keeps the one with the larger change id. Ids that increase on each device mean a change made on top of another in the same millisecond, by code rather than a person, still wins.
- Strings are easy to read in logs and to use as keys.

**Rejected:**
- Numbers counted by the household, which need the server, so nothing could be created offline.
- Random UUIDs (version 4), which scatter inserts across indexes.
- Ids as 16 raw bytes, which save about 20 bytes each, little next to a 1 KB stroke.

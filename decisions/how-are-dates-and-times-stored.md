# How are dates and times stored?
Decided in #24

**Applies when:** storing, sending or showing a date, a time of day or a moment, or working out what "today" is.

**Answer:**
- **Dates** are plain ISO 8601 dates with no time zone, such as `2026-11-16`. Page names and task dates already are.
- **Times of day** are ISO 8601 local times with no offset, such as `19:00`, so 7 pm means 7 pm wherever someone is.
- **Moments,** such as the start of an event from Google Calendar, are kept as instants. Each device shows them in its own time zone.
- **The household stores no time zone.** Each device works out "today", and which day a moment falls on, from its own clock and zone.
- **Features the server runs at a local time,** such as reminders sent as push notifications, take the zone from the device that set them up.

Times of day are built by #28, moments by #26, and reminders by #35.

**Why:** A member who's travelling sees their own "today", and events at their local times. Most of what a household plans, such as bins on Tuesday or dinner at 7 pm, means the same wherever the device is, so it's stored with no zone. Only moments fixed in the world, such as a meeting from Google Calendar, need one.

**Rejected:** A time zone stored in the household and used by every device. One set as a Worker variable.

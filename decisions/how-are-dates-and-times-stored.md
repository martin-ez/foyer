# How are dates and times stored?
Decided in #24 and #26

**Applies when:** storing, sending or showing a date, a time of day or a moment, or working out what "today" is.

**Answer:**
- **Dates** are plain ISO 8601 dates with no time zone, such as `2026-11-16`. Page names and task dates already are.
- **Times of day** are ISO 8601 local times with no offset, such as `19:00`, so 7 pm means 7 pm wherever someone is.
- **Moments,** such as the start and end of an event with times, are kept as instants, in milliseconds since 1970 in storage and as timestamps in the contracts. Each device shows them in its own time zone.
- **The household stores no time zone of its own.** Each device works out "today", and which day a moment falls on, from its own clock and zone.
- **The one exception is the day an event belongs to:** the day it starts in its Google calendar's time zone, which the household works out and stores as the event's `date`, so every device puts its sticker on the same day. For an all-day event, it's its first day. Each calendar takes the zone of the device its holder connected from, and the household keeps it, as Google has it, to work out its events' days.
- **Features the server runs at a local time,** such as reminders sent as push notifications, take the zone from the device that set them up.

Times of day are built by #28, and reminders by #35.

**Why:** A member who's travelling sees their own "today", and events at their local times. Most of what a household plans, such as bins on Tuesday or dinner at 7 pm, means the same wherever the device is, so it's stored with no zone. Only moments fixed in the world, such as a meeting from Google Calendar, need one. An event's sticker has to be on the same day page for everyone, so its day can't depend on each device's zone, and its calendar's zone is where the household lives its days.

**Rejected:** A time zone stored in the household and used by every device. One set as a Worker variable. For an event's day, each device's own zone, where devices in different zones can show a late event on different days and the board isn't the same for everyone.

# Where do calendar events live?
Decided in #25, #60 and #13

**Applies when:** showing, creating, moving or storing events, or asking Google for access.

**Answer:** In Google Calendar, which stays the source of truth. Every event in Foyer is a Google Calendar event: creating an event in Foyer, or turning a task into one, creates it in Google, and every change is written back. An event's body page and its sticker position live in Foyer, linked to the Google event.

Foyer works only with calendars it creates for itself, one Foyer calendar per space except the Inbox, and has read and write access to those and nothing else (Google's `calendar.app.created` permission):
- each person connects their own Google account: the one they sign in with. Foyer refuses any other account they pick in Google's screen;
- a personal space's calendar lives in its owner's account, seen only by them;
- a shared space's calendar lives in its creator's account if they've connected Google, and otherwise in the account of the member who connected first. If nobody has connected yet, the next member who connects holds every shared space without a calendar. Its holder never changes once the calendar exists, because that permission can't move a calendar to another account. Its holder shares it with the household's members in Google Calendar's own settings, which that permission can't change, and Foyer reminds them to;
- a member's Inbox has no calendar, because quick capture always makes a task;
- each calendar is named after its space, as "Foyer · Groceries", is renamed with it, and takes the time zone of the device its holder connected from. Spaces made before someone connects get their calendar when they do.

What members see, sent through sync and set only by the household:
- every member who sees a space sees who holds its calendar (`Space.calendar_member_id`) and its state (`calendar_state`): `none` until it exists, `syncing`, or `paused` when its holder's access stopped working or they disconnected;
- each member alone receives their own connection (`GoogleConnection`): `connected`, or `needs_reconnecting` once Google stops accepting the access. A member who never connected, or who disconnected, has none. Connecting again resumes their paused calendars; disconnecting revokes Foyer's access at Google and leaves the calendars and their events there.

Google's tokens and ids never leave the server, and backups and exports (#56) leave them out. The household keeps them in `google_connections` (one row per member: the refresh token, the permissions granted, the state, the time zone, when they connected and the current access token) and `space_calendars` (one row per space: its holder, Google's id for the calendar and the name Google has). Connecting is a call (`foyer.calendar.v1.CalendarService`), not a change through sync, as it happens outside the household's data.

Events in people's other Google calendars don't appear in Foyer; anything the household should see goes in a Foyer calendar.

Repeating events stay Google's: every occurrence is its own sticker on its own day, moving a sticker changes only that occurrence, and the whole series is changed in Google Calendar.

**Why:** Google Calendar is already complete, and people keep using it outside Foyer; letting Foyer have events of its own, or edit whole series, would slowly rebuild it. One calendar per space keeps the link clear and makes Google's sharing match Foyer's spaces, so a personal event stays private in Google too. Access limited to Foyer's own calendars keeps everything else private from Foyer. Using the account people sign in with stores nothing new about them. Showing every member a space's holder and state tells them why a shared space stopped updating and whose access to fix. This relies on Google letting an app see only the calendars it created; if that permission doesn't work as documented (#25), revisit this record.

**Rejected:** Connecting any Google account the person chooses, which would store a second account's id and email for each member. Waiting for a shared space's creator to connect, so that a space made by someone who never connects could never hold events. Showing each member only their own connection, so a shared space whose holder's access broke stops updating without saying why. Events that exist only in Foyer, which grow into a second calendar to keep in step with Google. A single Foyer calendar for the whole household, which would show every personal event to everyone in Google Calendar. Access to all of a person's calendars, which Foyer doesn't need. One shared "hub" Google account, which personal calendars don't fit.

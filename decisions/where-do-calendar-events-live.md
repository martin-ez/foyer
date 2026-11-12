# Where do calendar events live?
Decided in #10

**Applies when:** showing, creating, moving or storing events, or asking Google for access.

**Answer:** In Google Calendar, which stays the source of truth. Every event in Foyer is a Google Calendar event: creating an event in Foyer, or turning a task into one, creates it in Google, and every change is written back. An event's body page and its sticker position live in Foyer, linked to the Google event.

Foyer works only with calendars it creates for itself, one Foyer calendar per space, and has read and write access to those and nothing else:
- each person connects their own Google account;
- a personal space's calendar lives in its owner's account, seen only by them;
- a shared space's calendar lives in its creator's account and is shared with the space's members in Google Calendar's own settings.

Events in people's other Google calendars don't appear in Foyer; anything the household should see goes in a Foyer calendar.

**Why:** Google Calendar is already complete, and people keep using it outside Foyer; letting Foyer have events of its own would slowly rebuild it. One calendar per space keeps the link clear, and makes Google's sharing match Foyer's spaces, so a personal event stays private in Google too. Access limited to Foyer's own calendars keeps everything else private from Foyer.

**Rejected:** Events that exist only in Foyer, which grow into a second calendar to keep in step with Google. A single Foyer calendar for the whole household, which would show every personal event to everyone in Google Calendar. Access to all of a person's calendars, which Foyer doesn't need. One shared "hub" Google account, which personal calendars don't fit.

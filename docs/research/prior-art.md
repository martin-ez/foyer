# Prior art: planners, family hubs and ink canvases

Research from 2026-11-11, gathered while shaping the Foyer restart. It looks at
products close to Foyer's idea: a shared, tangible planner where the family
writes on fixed pages and calendar events, tasks and bills appear as live
stickers. Claims marked *(unverified)* rest on one weak source or on inference.

**Headline:** no product combines live calendar, task and bill stickers with
shared handwriting on fixed pages. Each piece exists somewhere; nobody puts them
together.

## Digital paper planners

- **Hyperlinked PDF planners** (GoodNotes, Notability, Noteshelf; templates on
  reMarkable, Kindle Scribe, Boox, Supernote):
  - You move between year, month, week and day with tabs, links and arrows.
  - Every view is its own PDF page, so ink belongs to one page only. Something
    written on the month page has to be written again on the week page.
    Artful Agenda lists "duplicate entry", "rewriting unfinished to-dos" and
    "items hard to move" as drawbacks.
  - Common complaints: links break on Windows and Android or after import;
    7–30 MB files lag; the toolbar eats the page; people want to lock objects
    and paste in the same spot on another page.
- **Notability's 2026 planner:** tapping a time slot opens Google Calendar.
  Nothing comes back onto the page.
- **Planner apps that read the calendar:**
  - **Pencil Planner & Calendar Pro:** you write over Apple Calendar events.
    Its v2 layouts share handwriting between Day and Week, the only case of
    ink shared across views found. Reviews report sync failures.
  - **Penjo:** events and reminders sit beside handwriting and can be ticked
    off on the page; unfinished ones carry forward as "Overdue". Pinch-zoom in
    week and month, plus a Year view.
  - **ZoomNotes:** planners can show Calendar and Reminders items; infinite
    zoom with subpages.
  - **Artful Agenda:** two-way Google sync, paper look, stickers. Handwriting
    fonts; Pencil only on a paid tier.
- **E-ink devices:** reMarkable and Kindle Scribe have no calendar integration
  (third-party tools push calendar snapshots as PDFs). Supernote syncs Google
  and Outlook and can turn lassoed handwriting into an event, but handwritten
  entries don't sync as they are.
- **Overall:** people love writing over their real calendar, and complain about
  sync and subscriptions. No app was found that keeps handwriting with an event
  when the event moves.

## Family hubs

- **What families use daily:** a calendar in one place you can glance at,
  shared grocery lists (Cozi's core), kids' chores and routines with rewards
  (Skylight, Hearth, Cozyla), and meal plans.
- **How they handle Google Calendar:**

  | Hub | Integration |
  |---|---|
  | Skylight | Two-way only if chosen at setup |
  | Hearth | Creates its own "Hearth" calendar that syncs both ways; other Google events are view-only |
  | Cozi | Read-only feed |
  | TimeTree | Mostly imports (sources conflict) |
  | Cozyla | Claims two-way sync |

- **Common complaints:**
  - Paywalls: Skylight about $79/year, Hearth $9/month, Mango needs Pro for
    calendar sync.
  - One-way sync catching people out, sync failures, and no support for several
    Google accounts (Hearth).
  - Cozi's dated interface and ads.
  - A partner who won't open yet another app.
- **Tangible feel:** no hub supports handwriting or a stylus. The closest are
  TimeTree's stickers and Skylight's celebrations when kids finish tasks.

## Multiplayer canvases with ink

- **Zoom:**
  - Freeform, tldraw, Excalidraw, Miro and Muse use infinite canvases, where
    getting lost is a known problem. Freeform added Scenes to jump between
    places; the others use frames as stand-in pages.
  - GoodNotes and OneNote use pages.
  - In Muse, tapping a nested board zooms into it.
- **Ink attached to objects:**
  - **Microsoft Whiteboard:** ink written on a sticky note is anchored to it.
  - **Miro:** for years drawings stayed behind when a sticky moved, a long-running
    complaint. When Miro shipped drawing on objects, people complained about
    ink attaching by accident and about layering.
  - **tldraw:** children move with their frame or group, and custom shapes can
    accept children.
- **Attribution and presence:**
  - **Freeform:** a colour per participant, visible cursors, Follow Along,
    join/leave notices, and undo of only your own changes. No per-stroke author
    log.
  - **OneNote:** an optional "Show authors" mode puts initials beside changes.
  - **GoodNotes:** live cursors for up to 50 people (names on cursors
    *unverified*).
  - **Excalidraw and tldraw:** named cursors; Excalidraw adds a laser pointer,
    tldraw a follow mode.

## Live data on a canvas

- **Miro Jira cards:** two-way sync via webhooks, but statuses go stale until a
  card is opened. Stale data undermines trust.
- **Microsoft Loop components in Whiteboard:** task lists that stay in sync
  everywhere they appear, including Planner and To Do.
- **Heptabase:** cards live in a library and can appear on several whiteboards;
  a calendar layout places dated journal cards and shows tasks due that day.
- **Kinopio:** `[]` turns a card into a checkbox; a Todo mode collects them.
- **Research prototypes:** Scrappy (reactive, multiplayer objects) and Ink &
  Switch's Inkbase and PlayBook (programmable ink).
- **What works:** one shared object shown in many places, with its source of
  truth kept elsewhere.

## Zooming through time

- **iOS 18 Calendar month view:** pinching steps from dots to bars to titles to
  times; a toolbar button does the same. Reviewers called the pinch "hidden".
- **Apple Photos:** Years/Months/Days zoom is the classic example. The iOS 18
  redesign removed Days and people objected; pinch came back later, and
  complaints flared again in 2026 when zoom-out was capped. Once people learn a
  zoom, they rely on it.
- **DateLens (2004 study):** a fisheye calendar was faster for long-range
  tasks, but people preferred the familiar day view for daily tracking.
- **Discoverability:** Baymard found not all users recognize "pinch"; pair the
  gesture with visible controls.

## Worth borrowing

- Hearth's pattern: a dedicated two-way Foyer calendar, with other calendars
  view-only.
- One object shown in many places (Heptabase, Loop): the same event or task
  sticker on the month, week and day pages.
- Freeform's attribution: a colour per person, presence, undo only your own
  changes; OneNote's optional author mode.
- Penjo's tick-off-on-page and carrying overdue items forward.
- iOS Calendar's pinch to change density, with a button as fallback.
- TimeTree's stickers and Skylight's celebrations.

## Worth avoiding

- Navigating by tabs and hyperlinks, huge single files, toolbars that eat the
  page.
- Ink that lives on one page only, forcing people to rewrite things.
- Ink that attaches to objects in ways people can't predict (Miro).
- One-way sync, and data that goes stale without saying so.
- Paywalling core features.
- Pinch as the only way to navigate.

## Gaps Foyer would fill

- Multiplayer handwriting with live Google Calendar, task and bill stickers on
  fixed pages.
- A family hub with handwriting at all.
- Notes that stay with an event when it is rescheduled (in Foyer: the
  sticker's body page).
- Ink that carries across month, week and day (only Pencil Planner shares it,
  and only between Day and Week).
- Bills as objects in a planner.

## Open questions it raised

- When a Google event moves, what happens to ink written beside its sticker?
- Is month-page ink the same ink as on the week and day pages, or does each
  view have its own? How does a busy day's handwriting look in the month view?
- How do fixed-shape pages work on a phone?
- Should attribution always show or appear on demand? Can kids erase a
  parent's ink?
- What happens when two people write in the same spot at once?
- Who can tick off a task or bill sticker, and does that write back to Google?
- How do people discover the zoom: buttons, breadcrumbs, a first-run hint?
- What happens to past weeks: archived, with overdue stickers carried forward?

## Sources

- https://artfulagenda.com/artful-agenda-vs-pdf-digital-planners-whats-the-difference-and-why-it-matters/
- https://intercom.help/notability/en-us/articles/16300278-how-to-use-digital-planners
- https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/47496641-goodnotes-for-digital-planner-users
- https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/42500011-have-imported-hyperlinks-work-in-all-views
- https://feedback.goodnotes.com/forums/950440-improve-goodnotes-for-android-windows-and-web/suggestions/47058718-goodnotes-for-android-beta-difficult-to-manage-l
- https://apps.apple.com/us/app/id1505638148
- https://apps.apple.com/app/apple-store/id6446053076
- https://apps.apple.com/app/id462234530
- https://apps.apple.com/us/app/artful-agenda/id1444781716
- https://support.supernote.com/1752821-supernote-calendar
- https://remarcal-docs.pages.dev
- https://hearth.zendesk.com/hc/en-us/articles/34948204212371-How-does-my-Hearth-Calendar-work-with-Google
- https://skylight.zendesk.com/hc/en-us/articles/19197773155995-Skylight-Calendar-2-Way-Sync
- https://www.cozi.com/blog/how-use-cozi-google-calendar/
- https://timetreeapp.com/intl/en/newsroom
- https://www.trustpilot.com/review/hearthdisplay.com
- https://myskylight.com/introducing-skylight-disney-mode/
- https://wetried.it/hearth-display-review-digital-calendar-organizer/
- https://www.blesserhouse.com/our-family-tried-the-skylight-calendar-heres-what-we-loved-didnt/comment-page-2/
- https://heynori-blog.pages.dev/cozi-alternative-family-organizer-apps
- https://goalsandprogress.com/shared-family-calendar-working-parents/
- https://support.apple.com/guide/freeform/frfm4e6e2c9a6
- https://9to5mac.com/2024/07/11/ipados-18-adds-one-new-feature-to-freeform-worth-trying-video/
- https://tldraw.dev/sdk-features/parenting
- https://tldraw.dev/sdk-features/frame-shape
- https://support.microsoft.com/en-us/whiteboard/add-notes-and-note-grids-in-whiteboard
- https://community.miro.com/ideas/allow-drawing-on-sticky-notes-61
- https://community.miro.com/ideas/sticky-notes-and-drawings-11707
- https://support.microsoft.com/en-us/office/show-authors-in-a-shared-notebook-in-onenote-for-windows-b6a043bd-e46b-4d50-9e96-b6df1b0ce569
- https://support.goodnotes.com/hc/en-us/articles/13922131401615-Collaborate-in-real-time-with-Live-Cursor
- https://museapp.com/guide
- https://help.miro.com/hc/articles/8588617184402
- https://community.miro.com/ask-the-community-45/resolved-oauth-2-0-jira-cards-app-set-up-jira-cloud-change-not-syncing-to-miro-board-card-title-14969
- https://support.microsoft.com/en-us/loop/loop-components-in-whiteboard
- https://wiki.heptabase.com/build-a-journal-calendar-whiteboard-in-heptabase
- https://wiki.heptabase.com/fundamental-elements
- https://kinopio.club/help/checkbox-cards
- https://pontus.granstrom.me/scrappy/
- https://www.inkandswitch.com/inkbase/
- https://9to5mac.com/2025/02/10/this-hidden-ios-18-trick-makes-apples-calendar-app-more-useful-than-ever/
- https://www.macrumors.com/2024/11/21/apples-photos-app-overhaul-controversial/
- https://discussions.apple.com/thread/256238375
- https://www.microsoft.com/en-us/research/wp-content/uploads/2004/03/tochidatelens.pdf
- https://baymard.com/research-articles/mobile-image-gestures

# Release checks

Before Foyer goes onto the household's devices, run the checks that agents can't: pen feel on a real iPad, real Google sign-in and calendar sync, two people on two devices, capture from a phone, and the iPad offline. Agents check everything else with the tests and the web and simulator checks, as [Development](development.md) explains.

Each check says what to do and what passes. Note the results as [Recording the results](#recording-the-results) says, and file each failure as an issue.

## Before you start

- **The household's Worker** runs the commit you're checking: Workers Builds deploys every push to `main`, so check that the latest build passed. The Google Cloud steps in [Deploying](deploying.md) are done for sign-in and for Google Calendar.
- **A release build on the iPad, calling the household's Worker.** Set `EXPO_PUBLIC_BACKEND_URL` to the household's address in `apps/client/.env.local`, as [Deploying](deploying.md) says, connect the iPad to the Mac, and run `pnpm --filter @foyer/client ios --device --configuration Release`. A development build runs slower, which spoils the pen-feel checks. Turn off Low Power Mode, which holds the screen at 60 Hz.
- **A second person,** a member of the household, with their own phone. The checks call you A, on the iPad, and them B, on their phone. Both of you open the web app on your phones at the household's address.
- **Two more Google accounts** that aren't members: one not on the allowlist, and a spare one to add to it and remove. Never remove a member's email for a check: leaving the household can't be undone, and their Google Calendar access is revoked and their shared calendars taken over.
- **A space for the checks:** a shared space, such as "Release checks", created by A after connecting Google Calendar. Make everything the checks need in it, so the household's own spaces stay tidy, and archive it once you're done. Its Google calendar stays in Google: delete it there if you don't want to keep it.

Start with Google Calendar: its last check needs a week to pass since A connected.

## 1. Pen feel

On the iPad, with the Apple Pencil. Compare with Markup on a screenshot, which draws with PencilKit alone, using its pen in both apps.

- **Lag:** film 10 strokes in each app with an iPhone's Slo-mo at 240 fps, the iPhone resting on a stand, exposure and focus locked, and nothing moved between the two. For each stroke, count the frames from the pen tip passing a point until the ink reaches it: each frame is about 4 ms.
  - **Passes when** Foyer's median is at most 8 ms more than Markup's, one screen frame at 120 Hz.
- **Pen lift:** in the same films, step frame by frame through the end of each stroke.
  - **Passes when** Foyer shows no gap, flicker or change in thickness that Markup doesn't. PencilKit trims some ink when the pen lifts in both.
- **Pinch:** fill a page with handwriting, a few hundred strokes, then pinch it in and out and pan it for a while. To measure it, profile Foyer on the iPad with Instruments' Animation Hitches template while you pinch.
  - **Passes when** nothing stutters, and Instruments reports no hitches.
- **Pencil down at awkward moments:** start a stroke right after a pinch ends, and another while the page is still gliding after a flick.
  - **Passes when** each stroke starts exactly where the pen touched, with nothing missing at its start.
- **Pencil and fingers:** start a stroke on a sticker, then drag a sticker with a finger.
  - **Passes when** the stroke neither opens nor moves the sticker, and the finger moves it.

## 2. Google sign-in

On the household's Worker, on the iPad and on A's phone.

- **Signing in** with Google on each.
  - **Passes when** each opens on the household, as A.
- **Signing out** on the phone.
  - **Passes when** the phone shows the sign-in screen, and the iPad stays signed in.
- **Not on the allowlist:** sign in on the phone with the account that isn't on it.
  - **Passes when** Foyer says "That Google account isn't part of this household.", and doesn't open it.
- **Removed from the allowlist:** add the spare account's email to `HOUSEHOLD_MEMBERS`, as [Deploying](deploying.md) says, and sign in with it on the phone. Then take it off the list, and reload the phone's tab. The spare account stays in the household as a member who left.
  - **Passes when** the phone is signed out, and signing in again with that account is refused.

## 3. Google Calendar

On the household's Worker, with A's Google account.

- **Connecting:** in the account menu, choose Connect Google Calendar, and continue past Google's "Google hasn't verified this app" screen.
  - **Passes when** Foyer shows A connected, on the iPad and the phone, and Google Calendar shows a "Foyer · Release checks" calendar.
- **From Foyer to Google:** add an event to the space in Foyer, then change its title.
  - **Passes when** Google Calendar shows it, with its new title, within a minute.
- **From Google to Foyer:** with Foyer open, add an event to the space's calendar in Google Calendar, then change its title there.
  - **Passes when** Foyer shows it on its day, with its new title, within a minute of each.
- **Repeating events:** in Google Calendar, add a weekly event to the space's calendar.
  - **Passes when** Foyer shows each week's occurrence on its own day, within a minute.
- **Moving a sticker to another day:** on the week page, drag an event's sticker to another day, and choose Change the date when Foyer asks.
  - **Passes when** Google Calendar shows the event on the new day, at the same times, within a minute.
- **Moving a sticker to another time:** on the day page, drag an event's sticker up or down.
  - **Passes when** Google Calendar shows it at the new time, within a minute.
- **A week later:** at least 7 days after A connected, rename the space in Foyer.
  - **Passes when** Google Calendar shows the calendar renamed within a minute, and Foyer doesn't show the space as paused.

## 4. Two people on two devices

A on the iPad and B on their phone, both on the same page in the space.

- **Who's on the page:** A points at the page with a finger or the Pencil, and B moves a finger on theirs. Then B leaves the page, comes back, and puts the browser in the background.
  - **Passes when** each sees the other's initial where they point, gliding between positions, and B's marker goes at once when B leaves the page or the browser goes to the background. The iPad shows A's marker only while the finger or the Pencil touches the page.
- **Ink:** A writes on the page, then erases a stroke.
  - **Passes when** B sees each stroke appear a moment after the pen lifts, and the erased stroke go.
- **Stickers moved by both:** A and B each move a different sticker. Then both move the same sticker at about the same time.
  - **Passes when** each sees the other's moves, and both end with the shared sticker in the same spot.
- **Ticking while the other is offline:** B turns on airplane mode, A ticks a task, then B turns airplane mode off. Then the other way round: A turns on airplane mode, B ticks another task, and A turns airplane mode off.
  - **Passes when** each task shows ticked on the device that was offline, within a few seconds of it reconnecting, without reloading.
- **Conflicting renames made offline:** both turn on airplane mode. A renames a task, then, a minute later, B renames the same task to something else. B turns airplane mode off first, then A.
  - **Passes when** both devices end with B's name, the rename made last, although A's arrived last.

## 5. Quick capture

On A's phone, an iPhone.

- **From the Shortcut:** build the Shortcut and put it on the Action Button or a widget, as [Capturing from a Shortcut](capturing-from-a-shortcut.md) says, with a key made on the household's Worker. Capture a task with it.
  - **Passes when** the task appears in A's Inbox on the iPad within a few seconds, and the Shortcut shows no error.
- **From the Shortcut, offline:** capture with airplane mode on.
  - **Passes when** the Shortcut shows an error, and nothing is added.
- **In the app, offline:** in the web app, turn on airplane mode, capture a task, and close the tab. Turn airplane mode off and open Foyer again.
  - **Passes when** the task is in A's Inbox, on the phone and the iPad.

## 6. The iPad offline

On the iPad, signed in as A, with airplane mode on.

- **Writing on a kept page:** open today's day page, write on it, erase a stroke, and move a sticker.
  - **Passes when** the page opens and takes all three.
- **A page the iPad doesn't keep:** open the month page of a month a few months ahead, which the iPad hasn't opened before.
  - **Passes when** Foyer says the page isn't on this iPad, and opens it once airplane mode is off.
- **Opening the app:** close Foyer from the app switcher and open it again.
  - **Passes when** it opens on the household, says it's offline, and today's day page shows what you wrote and erased.
- **Back online:** turn airplane mode off.
  - **Passes when** B's phone shows the strokes, the erasure and the moved sticker within a few seconds.

## Recording the results

Comment on the release's issue with the results, filling in this list, and file each failure as an issue that links the comment.

```md
Commit: <commit on main>
iPad: <model>, iPadOS <version>, Apple Pencil <generation>
Phones: <model>, iOS <version> (A); <model>, iOS <version> (B)

- [ ] 1. Pen feel: lag (Foyer <ms>, Markup <ms>), pen lift, pinch, Pencil down at awkward moments, Pencil and fingers
- [ ] 2. Google sign-in: signing in, signing out, not on the allowlist, removed from the allowlist
- [ ] 3. Google Calendar: connecting, from Foyer to Google, from Google to Foyer, repeating events, moving to another day, moving to another time, a week later
- [ ] 4. Two people on two devices: who's on the page, ink, stickers moved by both, ticking while offline, conflicting renames
- [ ] 5. Quick capture: from the Shortcut, from the Shortcut offline, in the app offline
- [ ] 6. The iPad offline: writing on a kept page, a page the iPad doesn't keep, opening the app, back online

Failures: <each check that failed, what happened, and its issue>
```

This is Foyer's Expo app, built as a native iPad app (a development build, not Expo Go) and as a web app. Pages are drawn with React Native Skia v3, published as `react-native-skia`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

The same applies to Skia: v3 differs from `@shopify/react-native-skia`. Its docs are in https://github.com/wcandillon/react-native-skia/tree/main/apps/docs/docs.

## Commands

Run these from the repository root:

```bash
pnpm --filter @foyer/client exec expo install <package>  # ALWAYS use instead of pnpm add — resolves SDK-compatible versions
pnpm --filter @foyer/client web                          # start the web app
pnpm --filter @foyer/client ios                          # build and run on an iPad simulator
pnpm --filter @foyer/client check-web                    # check the web app in a browser, with screenshots
pnpm --filter @foyer/client check-web --grep "<name>"    # run only the web checks whose names match
pnpm --filter @foyer/client check-web-export             # check the web app as deploys export and serve it
pnpm --filter @foyer/client check-ios-bundle             # build the iPad app's bundle
pnpm --filter @foyer/client check-ios-simulator          # check the iPad app on the simulator, on a Mac
pnpm check                                            # type checks, lint and formatting
pnpm format                                           # fix formatting and import order
```

Run `pnpm check` before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## The app's frame

- **Destinations:** once someone is signed in, `src/app/(household)/_layout.tsx` shows the frame, `src/shell/app-shell.tsx`. It's built with Expo Router's headless tabs (`expo-router/ui`) and holds three destinations: Calendar, Notebook and Tasks. Each is a route with its own address, such as `/tasks`. `/` opens the Calendar.
- **The bar** runs along the bottom of narrow windows and along the side of wider ones. It holds a Capture button, which opens a field above the open destination that adds tasks to the Inbox (`src/capture/`), the sync status, and an account menu with sign-out, the member's Google Calendar connection, the backend's status and Shortcuts, where members manage the capture key an iOS Shortcut captures with.
- **Google Calendar:** connect, reconnect and disconnect it with `useGoogleCalendar()` from `src/calendar/google-calendar-views.tsx`, which also says why connecting just didn't work. The web app leaves for Google and comes back to its first page; the iPad app connects in the system's sign-in sheet.
- **Events:** the Calendar lists the upcoming events above its page, where they're added, changed, moved and deleted (`src/calendar/events-panel.tsx`). `src/calendar/events.ts` holds what that needs without React Native, such as reading an event's time and the editor's fields in the device's time zone. The household writes events to Google and reads Google's changes back; the app only syncs them as items.
- **Calendar stickers:** dated tasks and events are stickers on their day of each calendar page. Whatever gives an item a date, or changes it, in `src/sync/household-sync.ts` also places or moves its calendar stickers in the same push, with `planCalendarStickers` from `@foyer/shared`, which the household uses too. Calendar pages' layouts, the size of their stickers and the next free spot in a day are also there. Tapping an empty spot in a day opens `src/calendar/add-to-day.tsx`, and a sticker dropped on another day asks before changing the date. On a day page, height means time: `dropOnDayPage` in `@foyer/shared` turns where a sticker is dropped into a time on the timeline, or none in the strip above it, and `moveOnDayPage` in `src/sync/household-sync.ts` changes the item's time to match. An event with times is drawn at its start on this device, with how long it lasts (`src/page/page-view.tsx`).
- **Hidden destinations** stay mounted and keep their state. React Activity isn't used to hide them: Skia's canvas crashes when it's shown again. A page is drawn, and the device is on it on the live lane, only while its destination is in front (`src/page/page-view.tsx`).
- **Sync:** the destinations share one connection to the household. Read it with `useHousehold()` from `src/shell/household.tsx`. In `src/sync/household-sync.ts`, the changes made in one `#make` are one action, which the household applies all or none, so make everything one thing a person does changes in one call. What each app keeps between launches comes from `src/sync/device-storage.ts`, and signing out forgets it:
  - The web app keeps only the member's unsent changes, in IndexedDB (`src/sync/browser-unsent-changes.ts`), and sends them first when it next opens.
  - The iPad app keeps a copy of the household in a SQLite database of the member's own (`src/sync/household-database.ts`): every row it receives, where it caught up to, the member's unsent changes, and the ink of the pages `keptPages` names (`src/sync/kept-pages.ts`), with when each page was last opened. It starts from the copy and catches up from its cursor. Once connected, it pulls each kept page's ink in turn, the shown page first and again last so that the connection follows it, and it forgets a page's strokes once the page leaves the set.
  - Without a connection, `canOpenPage` lets the page view open only the pages whose ink the iPad holds, and says the others aren't on this iPad.
  - Raise `copyLayout` in `src/sync/household-database.ts` whenever the copy's tables change: the iPad then rebuilds the copy from the household. It keeps the unsent changes and when pages were opened, which nothing else holds, so never change those two tables' layout without moving what they hold.
  - `household-database.ts` uses only a part of expo-sqlite's database, so its tests run it on Node's own SQLite (`test/node-sqlite.ts`).
- **When a view fails:** `src/shell/view-boundary.tsx` catches any error thrown while the open destination is drawn and shows a message in its place, keeping the frame, the bar and the household's connection, so unsaved changes are still sent. The web app offers to reload, which waits until nothing is unsaved; the iPad app, which can't reload itself, offers to try again. Opening another destination tries again too. React still logs the error.
- **After a deploy:** the web app loads each destination's file the first time it's opened, and a deploy replaces those files. When one doesn't load, the same boundary asks the server for the file (`src/shell/app-files.web.ts`). If the server answers, the app reloads once nothing is left unsaved, and only once for the same file. If it doesn't answer, the device is offline and the app says so instead. `web-export-checks/deploy.check.ts` checks this against the export, where views' files are loaded as when deployed.

## Skia on the web

- `index.web.tsx` loads CanvasKit before the app starts, so any screen can import Skia directly.
- `postinstall` copies `canvaskit.wasm` into `public/`. It is generated: never commit it.

## Pages

A page is drawn in points from its top-left corner, whatever its size or zoom. `PageDrawing` holds what's on a page, in the page's own coordinates, and both apps draw it:

- **On the iPad,** `src/page/page-sheet.tsx` puts a canvas of the page's own size inside a `ScrollView` that iOS zooms, so everything on the page moves with it in every frame of a pinch, including the bounce after it. Anything else drawn on the page, such as the Pencil's ink, goes inside that sheet, never in a view over it: a view over it drifts apart while iOS animates the zoom.
- **On the web,** `src/page/page-sheet.web.tsx` draws the desk in a canvas the size of the view, with the page where a camera puts it (`src/page/sheet-camera.ts`), and turns pinches, the wheel and drags into moving the camera.
- **Views on a page,** such as stickers (`src/page/page-stickers.tsx`) and the markers of others on it (`src/page/presence-markers.tsx`), are `PageSheet`'s children, laid out in the page's points. On the iPad they're inside the zoomed sheet; on the web, in a layer that the camera moves with the canvas. On the web, Skia has no fonts unless the app bundles a font file, which is why stickers and the markers' initials are views.
- **Typed text** is drawn by Skia, as paragraphs laid out once in page points (`src/text/text-layout.ts`) in the fonts in `assets/fonts/`, which `useTextFonts` loads: IBM Plex Sans, and Noto Color Emoji only once a page's text has emoji. `PageSheet` draws them through its `drawn` prop, inside the page's canvas, so they zoom with it. The views over the text, in `src/text/page-text.tsx`, are what screen readers read and what's tapped to edit a group or dragged to move it: each group is a button named by its text. While a group is edited, its text is a column of `TextInput`s over it, one per block, which show `*` and `**` around italic and bold (`src/text/typed-text.ts`), and `src/text/text-editing.ts` turns typing into changes, sending a block's text when typing pauses or the cursor leaves it. Text is read-only unless the device is up to date with the household.
- **Touches on a page** go to the page, to zoom and move it, unless a view on it asks for them with `pointerEvents: "auto"`, as stickers do. A drag on a view is in screen points: divide it by `usePageScale()` (`src/page/page-scale.ts`) to get points of the page. `src/page/sticker-drag.ts` drags stickers on the iPad with a `PanResponder`, which stops iOS scrolling the page while a finger holds one, and `sticker-drag.web.ts` with pointer events that never reach the page. A view on a page that's only tapped, such as a sticker's checkbox or a day's number on a calendar page, uses the same hook with only `tapped`: on the web the page captures the pointer, so a `Pressable` on it never hears the press.
- **What's printed on a page,** such as a calendar's grid, is a `Ruling` that `PageDrawing` draws under everything else. Its words, such as the days' numbers, are views on the page (`src/calendar/calendar-labels.tsx`).
- **A tap on the page itself,** rather than on a view on it, reaches `PageSheet`'s `onTap`, in the page's points; a touch that moves or zooms the page isn't one.
- **Ink** is drawn by Skia in a canvas of its own, `PageSheet`'s `ink`, above the page's views, so it lies over stickers and text. `src/ink/stroke-outline.ts` draws each stroke as PencilKit does, with the widths in `src/ink/ink-width.ts`, as one outline along both its edges, with round ends and a round joint wherever it turns back on itself, so a page of handwriting stays cheap to draw. The device follows the shown page's ink with `followInk`, which pulls it from that page's own cursor and, on the iPad, counts the page as opened among those it keeps (`src/ink/page-ink.ts`). The web app draws ink but can't write it: it has no Pencil.
  - **On the web,** the ink's canvas draws it from pictures (`src/page/ink-snapshots.tsx`): one of the whole page, and one of the view, sharp, taken once the page rests with nothing held down. Moving and zooming the page moves the pictures instead of drawing every stroke again, which takes seconds a frame for a page of handwriting. A new `ink` element draws them again, so `src/page/page-view.tsx` makes one only when the strokes change. Skia's canvas draws a frame later than React, so a replaced picture is let go a moment after.
- **The Apple Pencil** writes through `PageSheet`'s `pencil`, a native view from `modules/foyer-ink` laid over the page inside the zoomed sheet (`src/ink/page-pencil.tsx`).
  - PencilKit draws only the stroke being written, at the screen's resolution. When the pen lifts, the view sends the stroke to the app, which adds it with `addStroke`, and then tells the view once Skia has drawn it. PencilKit lets go of its copy a few frames later, so the hand-off never shows a gap.
  - Only the Pencil's touches reach the view. Fingers move and zoom the page, and touch what's on it.
  - The eraser removes whole strokes: the view reports where the Pencil moves, `strokesCrossed` in `src/ink/eraser.ts` finds the strokes it passes over, which are hidden at once, and they're erased together when it lifts.
  - The simulator has no Pencil. There, the ink tools have a switch, Draw with the mouse, which lets the mouse and Maestro's swipes draw, while the page doesn't move with them.

## Tests

`pnpm --filter @foyer/client test` runs the app's tests in Node with Vitest. They live in `test/`.

- **Unit tests** cover plain TypeScript code, such as `src/page/sheet-camera.ts`. Keep logic that needs no React Native in modules like that, so it can be tested on its own.
- **Golden images** check what pages draw. `expectToMatchGoldenImage` in `test/golden-image.ts` draws Skia elements on the CPU with Skia's headless build and compares them pixel by pixel with a PNG in `test/golden-images/`. Each feature that draws something adds its own images.
- Tests swap `react-native-skia` for its headless build, which has no `Canvas` and no React Native. So keep what a page draws in a component made only of Skia elements, such as `PageDrawing`, apart from the React Native view that sizes the canvas and hosts it.
- A drawing that throws or logs an error fails its test with that error, before it's compared or saved. The headless build also lacks some of the app's helpers, such as `vec`: a drawing that calls one fails with "is not a function", so write the value out instead, such as `{ x, y }` for a point.
- When a drawing differs, the test writes it and a diff, with the changed pixels in red, to `test/golden-images/failures/`. Look at both before deciding the change is intended. If it is, run `pnpm update-golden-images` from the repository root and commit the new images with the change, so the pull request shows them.
- A golden image that doesn't exist yet fails the test: create it with the same command.

## Checking the app

The root `AGENTS.md` says which checks to run for which change. In this package:

- **Web checks** are Playwright checks in `web-checks/`, one `*.check.ts` file each, run in an iPad's and a phone's viewport at once. They run against a backend of their own, at `http://localhost:8788`, whose household starts empty on every run, so they never touch the local household on 8787. Sign in with `signIn` from `web-checks/sign-in.ts`, as one of the members listed there, which are the only ones the checks' backend lets in. A check that changes what a member sees beyond a space of its own, as connecting Google Calendar does, signs in as a member of its own, added there. Save what a check shows with `saveScreenshot` from `web-checks/screenshot.ts`, which writes to `web-checks/screenshots/`.
- **Export checks** are Playwright checks in `web-export-checks/`, run by `check-web-export` against the web app as deploys export it, served by a backend of their own at `http://localhost:8789` without Expo's server. Each check first deploys the version it needs with `deploy` from `web-export-checks/versions.ts`: `current`, the app as it is, or `earlier`, the same app exported without minifying, so every file has another name. Deploying `current` under a tab opened on `earlier` stands in for a deploy under an open tab. They use the web checks' helpers, such as `signIn` and `saveScreenshot`. Production builds have no `window.foyerTest`.
- **A check that adds tasks** first creates a personal space of its own with `openSpaceOfItsOwn` from `web-checks/tasks.ts`, and works on that space's page, so that no other check adds to the pages it looks at. `sameMemberOnAnotherDevice` opens the same space in another tab.
- **A check that counts who is on a page** meets on a page no other check opens, as the live lane's check does on a day page a year ahead: every check that opens the Calendar lands on today's day page, and is counted there.
- **A check that follows something moving,** such as a marker gliding, records until it has arrived and asks for one position on the way, not a number of frames: a busy machine draws fewer.
- **Making the open view fail:** in development builds, `window.foyerTest.throwInOpenView()` makes the open destination throw while it's drawn, as a bug in it would (`src/shell/throw-when-asked.tsx`). Production builds don't have it.
- **Reading a page and adding strokes:** in development builds, `window.foyerTest.scene()` gives what's on the open page: its id, kind and size; its stickers, each with its id, kind, item, position and whether it's hidden; and its strokes, in the order they were drawn, each with its id, input, brush, box and number of samples. `window.foyerTest.addStrokes(fixture)` adds a stroke fixture's strokes to the open page with new ids, as if a pen had just drawn them, pushes them through sync, and returns their ids, so a check can follow them to another device (`src/page/scene-hooks.tsx`, `web-checks/scene.check.ts`). Production builds have neither, nor the fixtures.
- **On the iPad simulator,** a flow adds a fixture to the open page with `- openLink: foyer://dev/add-strokes?fixture=<name>`, and reads the scene as JSON from the element with the id `scene`, with `copyTextFrom` and then `assertTrue` on `JSON.parse(maestro.copiedText)`. Development builds follow `foyer://dev/` links where the app is, without opening a route (`src/app/+native-intent.tsx`, `src/shell/dev-links.ts`).
- **Stroke fixtures** are real Apple Pencil strokes, recorded on an iPad, in `packages/shared/test/fixtures/strokes/`: one JSON file each, holding each stroke's Protocol Buffers JSON form with its samples as the `Samples` message's, so a diff shows them. Import them by name from `@foyer/shared/stroke-fixtures`, and read one with `readStrokeFixture`. Each has a golden image drawn by Skia, `stroke-fixture-<name>`. The repository is public, so a fixture holds only neutral content, such as a sample sentence or a scribble, never a signature or anything personal. Recording one needs the owner and a real iPad: `docs/development.md` explains how. None is recorded yet: #265 records the first set, `handwritten-sentence`, `circle-and-scribble`, `fast-flick`, `tiny-dot` and `tilted-pencil`, and adds the first iPad flow that uses one. Until then, a check makes the fixture it adds, as `web-checks/scene.check.ts` does.
- **What another tab shows** after a change made on the first goes through `expectOnAnotherDevice` from `web-checks/another-device.ts`, which waits longer than Playwright's default while the change goes through the household. If it still times out, look at its trace, kept with `--trace retain-on-failure`: a delay that long is a bug to file, not a timing to wait out.
- Find what's on the page by role and text, as a person would, such as `getByRole("button", { name: "Sign out" })`, never by the page's structure or styles: views are wireframes and will change.
- Code that runs only on the iPad, such as `session-token.ts` beside its `.web.ts`, never runs in the web checks. `check-ios-bundle` checks it builds, and `check-ios-simulator` that it works, which needs a Mac.
- **iPad simulator checks** are Maestro flows in `ios-checks/`, one `.yaml` file each, run by `check-ios-simulator` on the booted iPad simulator against the installed development build, the local backend and Expo's development server. Run them, when you're on a Mac, for any change to code only the iPad runs, such as the Keychain or the Pencil. Start each flow with `- runFlow: steps/open-and-sign-in.yaml`, which opens the app afresh from Expo's server and signs in without Google as `you@example.com`, or with `steps/open.yaml`, which stops on the sign-in screen. Only development builds can sign in without Google, with `signInWithoutGoogle` in `src/session/sign-in.ts`. Find what's on the screen by its text or accessibility label, as with the web checks, and save what a flow shows with `takeScreenshot`, named like the web checks' screenshots, such as `first-page-ipad`. `docs/development.md` has how to run the app on the simulator.
- **Running the web checks:** a full run takes about 10 minutes, as long as a cloud session lets a command run in the foreground, which stops it without a result. So while working, run only the checks the change touches, with `--grep`. Run the full checks in the background, with their output in a file, and with `--trace retain-on-failure`, so a check that fails only in a full run keeps a trace. A run that's stopped can leave its backend running on port 8788, and the next run then fails at the start: stop it with `pkill -f -- '--port [8]788'`. `docs/development.md` has the commands, and how to read a trace in a terminal.

## Rules

- `ios/` is generated (Continuous Native Generation). Never create or edit it by hand — configure native behavior in `app.json` and config plugins.
- After adding a library with native code, rebuild the development build with `pnpm --filter @foyer/client ios`.
- Prefer recommended Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md

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
pnpm --filter @foyer/client check-ios-bundle             # build the iPad app's bundle
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
- **Calendar stickers:** dated tasks and events are stickers on their day of each calendar page. Whatever gives an item a date, or changes it, in `src/sync/household-sync.ts` also places or moves its calendar stickers in the same push, with `planCalendarStickers` from `@foyer/shared`, which the household uses too. Calendar pages' layouts, the size of their stickers and the next free spot in a day are also there. Tapping an empty spot in a day opens `src/calendar/add-to-day.tsx`, and a sticker dropped on another day asks before changing the date.
- **Hidden destinations** stay mounted and keep their state. React Activity isn't used to hide them: Skia's canvas crashes when it's shown again. A page is drawn, and the device is on it on the live lane, only while its destination is in front (`src/page/page-view.tsx`).
- **Sync:** the destinations share one connection to the household. Read it with `useHousehold()` from `src/shell/household.tsx`.

## Skia on the web

- `index.web.tsx` loads CanvasKit before the app starts, so any screen can import Skia directly.
- `postinstall` copies `canvaskit.wasm` into `public/`. It is generated: never commit it.

## Pages

A page is drawn in points from its top-left corner, whatever its size or zoom. `PageDrawing` holds what's on a page, in the page's own coordinates, and both apps draw it:

- **On the iPad,** `src/page/page-sheet.tsx` puts a canvas of the page's own size inside a `ScrollView` that iOS zooms, so everything on the page moves with it in every frame of a pinch, including the bounce after it. Anything else drawn on the page, such as the Pencil's ink, goes inside that sheet, never in a view over it: a view over it drifts apart while iOS animates the zoom.
- **On the web,** `src/page/page-sheet.web.tsx` draws the desk in a canvas the size of the view, with the page where a camera puts it (`src/page/sheet-camera.ts`), and turns pinches, the wheel and drags into moving the camera.
- **Views on a page,** such as stickers (`src/page/page-stickers.tsx`) and the markers of others on it (`src/page/presence-markers.tsx`), are `PageSheet`'s children, laid out in the page's points. On the iPad they're inside the zoomed sheet; on the web, in a layer that the camera moves with the canvas. On the web, Skia has no fonts unless the app bundles a font file, which is why stickers and the markers' initials are views.
- **Touches on a page** go to the page, to zoom and move it, unless a view on it asks for them with `pointerEvents: "auto"`, as stickers do. A drag on a view is in screen points: divide it by `usePageScale()` (`src/page/page-scale.ts`) to get points of the page. `src/page/sticker-drag.ts` drags stickers on the iPad with a `PanResponder`, which stops iOS scrolling the page while a finger holds one, and `sticker-drag.web.ts` with pointer events that never reach the page. A view on a page that's only tapped, such as a sticker's checkbox or a day's number on a calendar page, uses the same hook with only `tapped`: on the web the page captures the pointer, so a `Pressable` on it never hears the press.
- **What's printed on a page,** such as a calendar's grid, is a `Ruling` that `PageDrawing` draws under everything else. Its words, such as the days' numbers, are views on the page (`src/calendar/calendar-labels.tsx`).
- **A tap on the page itself,** rather than on a view on it, reaches `PageSheet`'s `onTap`, in the page's points; a touch that moves or zooms the page isn't one.

## Tests

`pnpm --filter @foyer/client test` runs the app's tests in Node with Vitest. They live in `test/`.

- **Unit tests** cover plain TypeScript code, such as `src/page/sheet-camera.ts`. Keep logic that needs no React Native in modules like that, so it can be tested on its own.
- **Golden images** check what pages draw. `expectToMatchGoldenImage` in `test/golden-image.ts` draws Skia elements on the CPU with Skia's headless build and compares them pixel by pixel with a PNG in `test/golden-images/`. Each feature that draws something adds its own images.
- Tests swap `react-native-skia` for its headless build, which has no `Canvas` and no React Native. So keep what a page draws in a component made only of Skia elements, such as `PageDrawing`, apart from the React Native view that sizes the canvas and hosts it.
- When a drawing differs, the test writes it and a diff, with the changed pixels in red, to `test/golden-images/failures/`. Look at both before deciding the change is intended. If it is, run `pnpm update-golden-images` from the repository root and commit the new images with the change, so the pull request shows them.
- A golden image that doesn't exist yet fails the test: create it with the same command.

## Checking the app

The root `AGENTS.md` says which checks to run for which change. In this package:

- **Web checks** are Playwright checks in `web-checks/`, one `*.check.ts` file each, run in an iPad's and a phone's viewport at once. They run against a backend of their own, at `http://localhost:8788`, whose household starts empty on every run, so they never touch the local household on 8787. Sign in with `signIn` from `web-checks/sign-in.ts`, and save what a check shows with `saveScreenshot` from `web-checks/screenshot.ts`, which writes to `web-checks/screenshots/`.
- **A check that adds tasks** first creates a personal space of its own with `openSpaceOfItsOwn` from `web-checks/tasks.ts`, and works on that space's page, so that no other check adds to the pages it looks at. `sameMemberOnAnotherDevice` opens the same space in another tab.
- **What another tab shows** after a change made on the first goes through `expectOnAnotherDevice` from `web-checks/another-device.ts`, which waits longer than Playwright's default while the change goes through the household. If it still times out, look at the trace: a delay that long is a bug to file, not a timing to wait out.
- Find what's on the page by role and text, as a person would, such as `getByRole("button", { name: "Sign out" })`, never by the page's structure or styles: views are wireframes and will change.
- Code that runs only on the iPad, such as `session-token.ts` beside its `.web.ts`, never runs in the web checks. `check-ios-bundle` checks it builds, and the simulator checks it works, which needs a Mac.

## Rules

- `ios/` is generated (Continuous Native Generation). Never create or edit it by hand — configure native behavior in `app.json` and config plugins.
- After adding a library with native code, rebuild the development build with `pnpm --filter @foyer/client ios`.
- Prefer recommended Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md

# Foyer

A household planner for tasks, calendar and notes that feels like paper.

## How we got here

To keep our house on track, we make use of a suite of amazing apps: Todoist, Google Calendar, Notion, and GoodNotes. They are all good at what they do, but they are disconnected, and more importantly, it constantly feels like work.

Foyer is my attempt to create an intuitive bridge that brings these useful blocks together, making it feel tangible and fun to use. It is very opinionated and tailored to how we want to organize our household, and it is far from a complete replacement for those tools.

## Embrace the mess

The underlying idea of Foyer is to embrace the mess of a household planner: a hub is where everyone can grab a marker and scribble, while still holding important information for everyone.

This gives us the building blocks of Foyer:

- **Pages** are paper-like sheets of a fixed size you can write on.
- **Ink** is what you write and draw on a page, initially supporting Apple Pencil.
- **Stickers** are tasks, events and notes stuck onto a page. Think of them as links to other items or pages.
- **Spaces** are the container where your pages and tasks live. They can be personal for projects, or shared to hold household things.

Using these building blocks, Foyer can build a couple of useful views:

- **Calendar**. Month, week and day pages, displayed as a bulletin board for the whole household to write on and collaborate.
- **Notebook**. A collection of all your notes, as a journal you flip through.
- **Tasks**. Quickly capture what needs to get done, as a simple To-Do list.
- **Budget** *(later)*. A monthly view of income, bills and budgets.

## Development

Foyer is a pnpm workspace with apps in `apps/` and shared code in `packages/`:

- `apps/client`: the Expo app, built as a native iPad app and as a web app. Pages are drawn with React Native Skia.
- `apps/server`: the backend, a Cloudflare Worker with one Durable Object per household.
- `packages/shared`: code used by both, including the contracts between them. The contracts are Protocol Buffers in `proto/`, and the TypeScript generated from them is committed in `src/gen/`.

Run `./scripts/setup.sh` to install the pinned Node and pnpm versions if they are missing, then the dependencies. It installs Node with nvm when you have it, and otherwise downloads it from nodejs.org into `~/.local`. After that:

- `pnpm --filter @foyer/client web` runs the web app.
- `pnpm --filter @foyer/client ios` builds the iPad app and runs it on a simulator. It needs Xcode and CocoaPods.
- `pnpm --filter @foyer/server dev` runs the backend locally, at `http://localhost:8787`. The app calls the backend there unless `EXPO_PUBLIC_BACKEND_URL` names another one.
- `pnpm generate` writes the TypeScript for the contracts again, after a `.proto` file changes. Commit what it writes: CI checks that it matches the contracts.
- `pnpm check` runs the type checks, linting and formatting checks that CI runs, including Buf's on the contracts.
- `pnpm --filter @foyer/shared check-breaking` checks that changes to the contracts don't break apps or data made with the contracts on your local `main` branch. CI runs it against `main` for every pull request.
- `pnpm test` runs the tests that CI runs: unit tests, the comparison of page drawings with their golden images, and the backend's tests in the Workers runtime.
- `pnpm update-golden-images` saves the current page drawings as the new golden images, for when a drawing changes on purpose.

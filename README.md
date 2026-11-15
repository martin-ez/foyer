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

## Getting started

Run `./scripts/setup.sh` to install the pinned Node and pnpm versions if they are missing, then the dependencies. Copy `apps/server/.dev.vars.example` to `apps/server/.dev.vars` and fill it in. Then run each of these in its own terminal:

- `pnpm --filter @foyer/server dev`, the backend;
- `pnpm --filter @foyer/client web`, the web app's development server.

Open the web app at `http://localhost:8787`. To sign in without Google, open `http://localhost:8787/auth/dev?email=you@example.com` with an email from `HOUSEHOLD_MEMBERS` in `.dev.vars`.

## Learn more

- [Development](docs/development.md): how the code is organised, its commands and tests, and signing in locally.
- [Deploying](docs/deploying.md): how changes reach the household, the secrets it needs, and previewing a branch.
- [Decisions](decisions/): how Foyer is built and why, one question per file.

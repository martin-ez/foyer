# Agent instructions

Foyer is a household planner for tasks, calendar and notes that feels like paper. The README explains the project and how to run it. Read `apps/client/AGENTS.md` before changing the app.

## How Foyer is built for now

- **Views are wireframes.** Until the first version works end to end, build what a view does, not how it looks, and choose provisional layouts and flows yourself. The owner designs the experience on top once the functionality is proven.
- **The owner decides experience that shapes data or sync.** Ask before building anything whose design decides what is stored, sent or synced, above all how presence and live multiplayer are shown.
- **The data model grows one issue at a time.** Before building anything that adds or changes stored data or a contract, set out that part on its issue and wait for the owner's review. Cover the messages and fields, what's stored where, the ids, who can see it, and how it connects to what exists.
- **No code names.** Don't use code names, such as lettered options or nicknames for designs, in code, documents, issues or milestones. Say what the thing is.

# Agent instructions

Foyer is a household planner for tasks, calendar and notes that feels like paper. The README explains the project and how to run it, and `docs/development.md` how to work on it. Read `apps/client/AGENTS.md` before changing the app.

## How Foyer is built for now

- **Views are wireframes.** Until the first version works end to end, build what a view does, not how it looks, and choose provisional layouts and flows yourself. The owner designs the experience on top once the functionality is proven.
- **The owner decides experience that shapes data or sync.** Ask before building anything whose design decides what is stored, sent or synced, above all how presence and live multiplayer are shown.
- **The data model grows one issue at a time.** Before building anything that adds or changes stored data or a contract, set out that part on its issue and wait for the owner's review. Cover the messages and fields, what's stored where, the ids, who can see it, and how it connects to what exists.
- **No code names.** Don't use code names, such as lettered options or nicknames for designs, in code, documents, issues or milestones. Say what the thing is.

## Checking your work

Check a change yourself before asking for review, with the checks that fit it, as `docs/development.md` explains:

- **Every change:** `pnpm check` and `pnpm test`.
- **A change to the app, or to what the backend answers it:** `pnpm --filter @foyer/client check-web`, which opens the web app, signs in and takes screenshots, in an iPad's and a phone's viewport. When the change adds or changes something people do in the app, also check that, in `apps/client/web-checks/`. Views are wireframes, so check what a view does, not how it looks.
- **A change to the app's code, its dependencies or `app.json`:** `pnpm --filter @foyer/client check-ios-bundle`, the closest a cloud session gets to the iPad.

Share what you checked:

- **Screenshots:** you may push to the `screenshots` branch, only in your own pull request's folder, `pr-<number>/`. Then comment on the pull request with the images and what was checked, as `docs/development.md` explains.
- **The running app:** in a cloud session, when the owner asks to look, or a change is ready to look at, tell the Claude app that the web app is on port 8787, so the owner can open it from there.

## Signing in

Locally, sign in without Google at `http://localhost:8787/auth/dev?email=…`, with an email from `HOUSEHOLD_MEMBERS` in `apps/server/.dev.vars`, as `docs/development.md` explains. Never ask the owner to sign in with Google for you.

## Previewing a branch

Start the preview only when the owner asks. `pnpm --filter @foyer/server preview` deploys your checkout to the preview, replacing whatever was there, and prints its address. Post the address on the branch's pull request.

Wrangler needs a Cloudflare token and the account id:

- **Token:** in a cloud session, ask the owner for a Cloudflare token through the cloud environment's credential form, for `api.cloudflare.com`. Never ask for it in the chat. Then run the script with `CLOUDFLARE_API_TOKEN=placeholder`: the session's proxy replaces it with the saved token.
- **Account id:** if `CLOUDFLARE_ACCOUNT_ID` isn't set, propose adding it to the cloud environment's variables. It isn't secret, but keep it out of the repository, along with the account's `workers.dev` subdomain.

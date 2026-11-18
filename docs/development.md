# Development

Foyer is a pnpm workspace with apps in `apps/` and shared code in `packages/`:

- `apps/client`: the Expo app, built as a native iPad app and as a web app. Pages are drawn with React Native Skia.
- `apps/server`: the backend, a Cloudflare Worker with one Durable Object per household.
- `packages/shared`: code used by both, including the contracts between them. The contracts are Protocol Buffers in `proto/`. The TypeScript for them is generated into `src/gen/` when the dependencies are installed, and git ignores it.

Run `./scripts/setup.sh` to install pnpm if it's missing, then the dependencies. pnpm is installed with npm, so when it's missing the script first installs the Node major version in `.nvmrc`, with nvm when you have it, and otherwise from nodejs.org into `~/.local`.

pnpm runs the project's scripts, and the tools they start, on the Node version that `devEngines.runtime` in `package.json` pins. `pnpm install` downloads that version into `node_modules`, so the Node your shell finds first doesn't matter. Cloud sessions, for example, come with Node 22. `pnpm exec node` runs the pinned version. If an install skips the download, `engineStrict` in `pnpm-workspace.yaml` makes it fail on any Node older than `engines` in `package.json`. To move to another Node version, change `.nvmrc`, `engines` and `devEngines.runtime` together, then run `pnpm install`. CI fails when `.nvmrc` isn't the major version of `devEngines.runtime`, or `engines` isn't its minimum. `.nvmrc` is the Node that CI and Cloudflare's builds run pnpm on. Recording the new version in `pnpm-lock.yaml` needs `nodejs.org` and `unofficial-builds.nodejs.org`.

After that:

- `pnpm --filter @foyer/server dev` runs the backend locally, at `http://localhost:8787`. The local backend reads its secrets and settings, such as the emails that may sign in, from `apps/server/.dev.vars`, which git ignores: copy `apps/server/.dev.vars.example` there and fill it in.
- `pnpm --filter @foyer/client web` runs Expo's development server for the web app. Open the web app at the local backend's address, `http://localhost:8787`, which forwards the app's pages to Expo, so that the web app and the backend share one address as they do when deployed.
- `pnpm --filter @foyer/client export-web` exports the web app as static files, into `apps/client/dist`, as deploys do. To try the export at the local backend's address, remove `WEB_APP_DEV_SERVER` from `.dev.vars` and run `pnpm --filter @foyer/server exec wrangler dev`, which serves the export as the deployed Worker does.
- `pnpm --filter @foyer/client ios` builds the iPad app and runs it on a simulator. It needs Xcode and CocoaPods. The iPad app calls the local backend unless `EXPO_PUBLIC_BACKEND_URL` names another one.
- `pnpm generate` writes the TypeScript for the contracts again. `pnpm install` only generates it when it has dependencies to install, so after pulling or switching branches it can be stale. The scripts that run, check or ship the code generate it first, so they never use stale code: `pnpm typecheck`, `pnpm check` and `pnpm test`; the scripts that start the backend and the app, `dev`, `web`, `start` and `ios`; the iPad bundle check; and the `preview` and `deploy` scripts. Run it yourself when a `.proto` file changes while the servers are already running, or for your editor. There is nothing to commit.
- `pnpm check` runs the type checks, linting and formatting checks that CI runs, including Buf's on the contracts.
- `pnpm --filter @foyer/shared check-breaking` checks that changes to the contracts don't break apps or data made with the contracts on your local `main` branch. CI runs it against `main` for every pull request.
- `pnpm test` runs the tests that CI runs: unit tests, the comparison of page drawings with their golden images, and the backend's tests in the Workers runtime.
- `pnpm update-golden-images` saves the current page drawings as the new golden images, for when a drawing changes on purpose.
- `pnpm --filter @foyer/client check-web` and `pnpm --filter @foyer/client check-ios-bundle` check the app as a whole, as [Checking the app](#checking-the-app) explains.

## Checking the app

The tests check pieces of code on their own. Two more checks look at the app as a whole, to check your work before asking for review. CI doesn't run them.

- **In a browser:** `pnpm --filter @foyer/client check-web` runs the checks in `apps/client/web-checks/` with Playwright, in Chromium, in an iPad's viewport and a phone's.
  - It starts Expo's development server and then the backend, or reuses ones already running, and waits until `http://localhost:8787` answers 200, which it does only once Expo's server is up, since the backend forwards the app's pages to it. Playwright stops the servers it started when it's done.
  - The checks sign in without Google as the first email in `HOUSEHOLD_MEMBERS` in `.dev.vars`, and save screenshots in `apps/client/web-checks/screenshots/`, such as `first-page-ipad.png`. The live lane's check also signs in as the second email, to put two members on the same page, and is skipped when there's only one.
  - The first visit waits while Expo builds the app's bundle, which takes up to a minute after the dependencies change.
  - Playwright needs its Chromium. Cloud sessions come with it. On your computer, download it once with `pnpm --filter @foyer/client exec playwright install chromium`.
- **The iPad app's bundle:** `pnpm --filter @foyer/client check-ios-bundle` builds the JavaScript the iPad app runs, compiled for Hermes, into a temporary folder that it deletes afterwards. It fails on code that doesn't build for iOS, such as a broken import in a file only the iPad app uses, and needs no Mac. It takes about 30 seconds.

Running the app on the iPad simulator needs a Mac with Xcode: [#110](https://github.com/martin-ez/foyer/issues/110) adds how to check it there.

## Cloud sessions

Most work on Foyer happens in Claude Code cloud sessions. Their environment's setup script runs `./scripts/setup.sh` and copies `apps/server/.dev.vars.example` to `apps/server/.dev.vars`, so a session starts with the dependencies installed and can sign in without Google as `you@example.com`.

A cloud session runs the backend, Expo's development server, `pnpm check`, `pnpm test` and both of the checks above. It can't run the iPad simulator, which needs macOS. It can deploy the preview, with a Cloudflare token as [`AGENTS.md`](../AGENTS.md) says, but the preview has no sign-in without Google, so agents can't sign in there.

- **Playwright** launches the Chromium in `/opt/pw-browsers`, which `PLAYWRIGHT_BROWSERS_PATH` points to. It can't download browsers there. The Playwright version in the workspace catalog is the one cloud sessions come with. If they move to a version whose Chromium differs, the config launches theirs rather than fail; move the catalog to the new version to match.
- **The servers** keep running between commands when started in the background, with their output in files:

  ```bash
  nohup pnpm --filter @foyer/server dev > /tmp/foyer-server.log 2>&1 &
  nohup pnpm --filter @foyer/client web > /tmp/foyer-web.log 2>&1 &
  ```

  The backend answers 500 until Expo's development server is ready. Then sign in at `http://localhost:8787/auth/dev?email=you@example.com`, and the web checks reuse both servers.
- **The running app:** while the session is open, the agent can tell the Claude app that the web app is on port 8787, and you can open it from there.

### Sharing screenshots

Screenshots go on the `screenshots` branch, which is never merged. Each pull request gets a folder there, `pr-<number>/`, linked from a comment on it. The images are public, like the code, so they show only development data. The branch can be deleted at any time.

When a pull request is merged or closed, the Screenshots workflow deletes its folder. Its comments keep showing the images, because they link to the commit that added them.

Share only the screenshots that show what the change does, not every one the checks take. Commit them to the pull request's folder from a separate worktree, so your checkout stays on its branch:

```bash
git fetch origin screenshots
git worktree add --detach /tmp/foyer-screenshots FETCH_HEAD
mkdir -p /tmp/foyer-screenshots/pr-123
cp apps/client/web-checks/screenshots/first-page-*.png /tmp/foyer-screenshots/pr-123/
git -C /tmp/foyer-screenshots add pr-123
git -C /tmp/foyer-screenshots commit -m "Screenshots for pull request 123"
git -C /tmp/foyer-screenshots push origin HEAD:screenshots
git -C /tmp/foyer-screenshots rev-parse HEAD
git worktree remove /tmp/foyer-screenshots
```

Then comment on the pull request with the images and what was checked. Link each image by the commit that `rev-parse` printed, such as `https://raw.githubusercontent.com/martin-ez/foyer/<commit>/pr-123/first-page-ipad.png`, so the comment keeps showing these images after later screenshots replace them.

## Signing in locally

Signing in with Google needs a Google OAuth client, set in `apps/server/.dev.vars` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, as [Google sign-in](deploying.md#google-sign-in) explains. Without one, open `http://localhost:8787/auth/dev?email=you@example.com` to sign in as an email on the allowlist, which works while `.dev.vars` sets `DEV_SIGN_IN=1`. Add `&app=ipad` to return to the iPad app instead, at `foyer://signed-in`.

## Connecting Google Calendar locally

While `.dev.vars` sets `DEV_SIGN_IN=1`, connecting Google Calendar uses a fake Google, in `apps/server/src/fake-google.ts`, instead of Google, even when `.dev.vars` sets a Google client. "Connect Google Calendar" opens its page at `http://localhost:8787/auth/dev/google`, which offers to continue as the member's own account, as another account, or without calendar access, and to cancel, and returns as Google would. The fake keeps the calendars it makes, and their events, in memory, so they're forgotten when the backend restarts, and the household then makes each space's calendar again and writes its events back into it. The backend's tests connect to the same fake, and can make it fail, revoke a member's access, change events or refuse changes to them.

To change events as if in Google Calendar, open the fake's calendars at `http://localhost:8787/auth/dev/google/calendar`. It lists each calendar, with its account and time zone, and its events, and can add an event, change an event's title, delete an event, delete a calendar, or drop a calendar's sync tokens. An all-day event's end there is the day after its last day, as in Google. The household reads every calendar's changes as soon as a device connects, then every minute while one is connected, so a change made there reaches the app within a minute, or at once when the app is reloaded.

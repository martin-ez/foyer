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
- `pnpm generate` writes the TypeScript for the contracts again, unless what's in `src/gen/` was written from the same contracts, Buf configuration and generator versions, so scripts that start at the same moment on up-to-date code, such as `dev` and `web`, leave it untouched. To write it afresh anyway, delete `packages/shared/src/gen/`. `pnpm install` only generates it when it has dependencies to install, so after pulling or switching branches it can be stale. The scripts that run, check or ship the code generate it first, so they never use stale code: `pnpm typecheck` and `pnpm check`; each package's `test` and the app's `update-golden-images`, whether run from the root or with `--filter`; the scripts that start the backend and the app, `dev`, `web`, `start` and `ios`; the iPad bundle check; and the `preview` and `deploy` scripts. Run it yourself when a `.proto` file changes while the servers are already running, or for your editor. There is nothing to commit.
- `pnpm check` runs the type checks, linting and formatting checks that CI runs, including Buf's on the contracts.
- `pnpm --filter @foyer/shared check-breaking` checks that changes to the contracts don't break apps or data made with the contracts on your local `main` branch. CI runs it against `main` for every pull request.
- `pnpm test` runs the tests that CI runs: unit tests, the comparison of page drawings with their golden images, and the backend's tests in the Workers runtime. It runs one package's tests at a time, because each generates the contracts' TypeScript first, which, when it's out of date, replaces `src/gen/` while another package's tests could be reading it. `pnpm --filter <package> test` runs one package's tests.
- `pnpm update-golden-images` saves the current page drawings as the new golden images, for when a drawing changes on purpose.
- `pnpm --filter @foyer/client check-web`, `pnpm --filter @foyer/client check-web-export` and `pnpm --filter @foyer/client check-ios-bundle` check the app as a whole, as [Checking the app](#checking-the-app) explains.

## Checking the app

The tests check pieces of code on their own. Three more checks look at the app as a whole, to check your work before asking for review. CI doesn't run them.

- **In a browser:** `pnpm --filter @foyer/client check-web` runs the checks in `apps/client/web-checks/` with Playwright, in Chromium, in an iPad's viewport and a phone's.
  - It generates the contracts' TypeScript first, so the two servers it starts find it up to date and neither replaces it while the other reads it. Then it starts Expo's development server, or reuses one already running, and a backend of its own at `http://localhost:8788`, whose household starts empty on every run. It never reuses the backend at `http://localhost:8787`, so the household you try the app in stays as it was. The checks' backend keeps its storage in `apps/server/.wrangler/web-checks`, which it empties when it starts, and forwards the app's pages to Expo's server as the usual backend does, so the two can share it.
  - Playwright waits until `http://localhost:8788` answers 200, which it does only once Expo's server is up, and stops the servers it started when it's done. A run fails at the start, saying `http://localhost:8788 is already used`, if something else already listens on 8788, such as another run.
  - A run that's stopped before it's done, such as a command that ran out of time, can leave the servers it started running. The next run reuses Expo's server, but fails at the start on the checks' backend. Stop the checks' backend, then check that nothing listens on 8788 any more. The brackets keep `pkill` from matching the shell it runs in, whose own command line holds the pattern:

    ```bash
    pkill -f -- '--port [8]788'
    lsof -nP -iTCP:8788 -sTCP:LISTEN
    ```

  - The checks' backend lets in the members listed in `apps/client/web-checks/sign-in.ts`, in place of `HOUSEHOLD_MEMBERS` in `.dev.vars`, so the checks run the same whatever a `.dev.vars` lists. The checks sign in as them without Google: most as `you@example.com`, and those that need two people, such as the live lane's, also as `housemate@example.com`. The Google Calendar checks sign in as members no other check uses, one for each viewport, so connecting Google Calendar and adding events never changes what another check sees.
  - The checks save screenshots in `apps/client/web-checks/screenshots/`, such as `first-page-ipad.png`.
  - Arguments after `check-web` go to `playwright test`: `--grep "dragged sticker"` runs only the checks whose names match, `--project ipad` only the iPad's viewport, and `--last-failed` only the checks that failed in the last run.
  - A failed check keeps a screenshot in `apps/client/web-checks/results/`. With `--trace retain-on-failure`, it also keeps a trace there: each step the check took, what was on the page at each one, and the page's network requests and console. A check that fails only in a full run can't be traced by running it alone, so add the option to full runs. Each run empties the folder first, so read a failure's trace before running the checks again. Read a trace in a terminal with Playwright's `trace` commands, from `apps/client`:

    ```bash
    pnpm exec playwright trace open web-checks/results/<check>/trace.zip
    pnpm exec playwright trace actions
    pnpm exec playwright trace errors
    pnpm exec playwright trace snapshot <step> --phase before
    pnpm exec playwright trace close
    ```

    `actions` numbers the steps, `snapshot` shows the page's roles and text at one of them, and `requests` and `console` show the rest. On a computer with a screen, `pnpm exec playwright show-trace <trace.zip>` opens the trace in Playwright's trace viewer instead.
  - Checks that add tasks first create a personal space of their own and work on its page, so that no other check, such as the same check in the other viewport, adds to the pages they look at.
  - The first visit waits while Expo builds the app's bundle, which takes up to a minute after the dependencies change.
  - Playwright needs its Chromium. Cloud sessions come with it. On your computer, download it once with `pnpm --filter @foyer/client exec playwright install chromium`.
- **The exported web app:** `pnpm --filter @foyer/client check-web-export` checks the web app as deploys export it, served as the deployed Worker serves it. `check-web` never sees the export: it runs the app on Expo's development server, where some things work differently, such as how a view's file is loaded. Run it for changes to how the web app is built, loaded or served. It takes about a minute.
  - It exports the web app twice, into `apps/client/web-export-checks/versions/`: once as deploys do, and once without minifying, so that every file has another name. The second stands in for the version that a deploy replaces under an open tab.
  - Its backend, at `http://localhost:8789`, serves the export without Expo's server, with a household that starts empty on every run, stored in `apps/server/.wrangler/web-export-checks`. It lets in the web checks' members, and sets the settings it needs itself, so `.dev.vars` doesn't change what it serves.
  - Each check first deploys the version it needs, by replacing the files the backend serves, and waits until the backend has restarted with them, as after a deploy. So the checks run one at a time.
  - The checks are in `apps/client/web-export-checks/`, with their screenshots in `screenshots/` and failures in `results/` there. Arguments after `check-web-export` go to `playwright test`, as with `check-web`.
  - A run that's stopped before it's done can leave its backend running, and the next run then fails at the start. Stop it with `pkill -f -- '--port [8]789'`.
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

  The backend answers 500 until Expo's development server is ready. Then sign in at `http://localhost:8787/auth/dev?email=you@example.com`. The web checks reuse Expo's server, and start a backend of their own beside this one.
- **The web checks:** a full run takes about 10 minutes, as long as a cloud session lets a command run in the foreground, which stops it without printing a result. Run it as a background command, which tells you when it ends, with its output in a file:

  ```bash
  pnpm --filter @foyer/client check-web --trace retain-on-failure > /tmp/foyer-check-web.log 2>&1
  ```

  While working, run only the checks the change touches, with `--grep`. If a run is stopped anyway, stop the backend it left running before the next one, as [Checking the app](#checking-the-app) says.
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

To change events as if in Google Calendar, open the fake's calendars at `http://localhost:8787/auth/dev/google/calendar`. It lists each calendar, with its account and time zone, and its events, and can add an event, change an event's title, delete an event, delete a calendar, or drop a calendar's sync tokens. An all-day event's end there is the day after its last day, as in Google. An event added with a rule in Repeats, such as `FREQ=WEEKLY;BYDAY=TU` or `FREQ=DAILY;COUNT=5`, is a repeating series, which the household makes an event of for each of its days, and changing its title or deleting it changes the whole series. An occurrence changed or deleted on its own, in Foyer or on the page, is listed as an event of its own, and changing or deleting it there changes only it. The household reads every calendar's changes as soon as a device connects, then every minute while one is connected, so a change made there reaches the app within a minute, or at once when the app is reloaded.

# Development

Foyer is a pnpm workspace with apps in `apps/` and shared code in `packages/`:

- `apps/client`: the Expo app, built as a native iPad app and as a web app. Pages are drawn with React Native Skia.
- `apps/server`: the backend, a Cloudflare Worker with one Durable Object per household.
- `packages/shared`: code used by both, including the contracts between them. The contracts are Protocol Buffers in `proto/`. The TypeScript for them is generated into `src/gen/` when the dependencies are installed, and git ignores it.

Run `./scripts/setup.sh` to install the pinned Node and pnpm versions if they are missing, then the dependencies. It installs Node with nvm when you have it, and otherwise downloads it from nodejs.org into `~/.local`. After that:

- `pnpm --filter @foyer/server dev` runs the backend locally, at `http://localhost:8787`. The local backend reads its secrets and settings, such as the emails that may sign in, from `apps/server/.dev.vars`, which git ignores: copy `apps/server/.dev.vars.example` there and fill it in.
- `pnpm --filter @foyer/client web` runs Expo's development server for the web app. Open the web app at the local backend's address, `http://localhost:8787`, which forwards the app's pages to Expo, so that the web app and the backend share one address as they do when deployed.
- `pnpm --filter @foyer/client export-web` exports the web app as static files, into `apps/client/dist`, as deploys do. To try the export at the local backend's address, remove `WEB_APP_DEV_SERVER` from `.dev.vars` and run `pnpm --filter @foyer/server exec wrangler dev`, which serves the export as the deployed Worker does.
- `pnpm --filter @foyer/client ios` builds the iPad app and runs it on a simulator. It needs Xcode and CocoaPods. The iPad app calls the local backend unless `EXPO_PUBLIC_BACKEND_URL` names another one.
- `pnpm generate` writes the TypeScript for the contracts again. Run it after a `.proto` file changes, including after pulling or switching branches: `pnpm install` only generates it when it has dependencies to install. There is nothing to commit. `pnpm typecheck`, `pnpm check` and `pnpm test` generate it first, so they never use stale code.
- `pnpm check` runs the type checks, linting and formatting checks that CI runs, including Buf's on the contracts.
- `pnpm --filter @foyer/shared check-breaking` checks that changes to the contracts don't break apps or data made with the contracts on your local `main` branch. CI runs it against `main` for every pull request.
- `pnpm test` runs the tests that CI runs: unit tests, the comparison of page drawings with their golden images, and the backend's tests in the Workers runtime.
- `pnpm update-golden-images` saves the current page drawings as the new golden images, for when a drawing changes on purpose.

## Signing in locally

Signing in with Google needs a Google OAuth client, set in `apps/server/.dev.vars` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, as [Google sign-in](deploying.md#google-sign-in) explains. Without one, open `http://localhost:8787/auth/dev?email=you@example.com` to sign in as an email on the allowlist, which works while `.dev.vars` sets `DEV_SIGN_IN=1`. Add `&app=ipad` to return to the iPad app instead, at `foyer://signed-in`.

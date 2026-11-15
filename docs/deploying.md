# Deploying

The household's Foyer runs on Cloudflare, at `https://foyer.<subdomain>.workers.dev`, where `<subdomain>` is the Cloudflare account's `workers.dev` subdomain. One Worker serves both the web app and the backend there. Cloudflare's Workers Builds deploys it on every push to `main`, whether or not CI passed. Its settings live in the Worker's settings in the Cloudflare dashboard:

- **Worker name:** `foyer`, the name in `apps/server/wrangler.jsonc`.
- **Production branch:** `main`.
- **Root directory:** the repository root.
- **Build command:** none. Builds install the dependencies first, with the Node version in `.nvmrc` and the pnpm version in `package.json`.
- **Deploy command:** `pnpm --filter @foyer/server run deploy`.
- **Preview builds:** off. They would build every pushed branch as its own preview.
- **Build cache:** on.

To change what a build does, change the `deploy` script rather than the dashboard, so the change goes through a pull request.

## The web app

The `deploy` and `preview` scripts first export the web app with Expo, into `apps/client/dist`, and the Worker deploys it as its static assets:

- **The app's files,** such as its JavaScript and `canvaskit.wasm`, are served without running the Worker, so they don't count against its daily requests.
- **Every other request runs the Worker.** It answers its own routes first: the calls in the contracts, and sign-in under `/auth/`. Any other address gets the app's `index.html`, and the app shows the page for that address. A missing file, such as a script from an older deploy, is not found rather than answered with the page.

The local backend never serves the export: it forwards pages to Expo's development server, as [Development](development.md) explains.

## Who can sign in

The Worker lets in the emails listed in its `HOUSEHOLD_MEMBERS` secret, a JSON list such as `["alex@example.com", "sam@example.com"]`. Set it in the Worker's settings in the Cloudflare dashboard, or with `pnpm --filter @foyer/server exec wrangler secret put HOUSEHOLD_MEMBERS`. A change takes effect at once, with no deploy. Deploys fail until it's set, and a list that isn't valid lets nobody in.

## Google sign-in

People sign in with Google, through a Google OAuth client the Worker holds in two secrets, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Deploys fail until both are set. To create the client:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and set up its OAuth consent screen. While the app is in testing, add the household's Google accounts as test users.
2. Create an OAuth client of type "Web application". Add the callback address of each environment as an authorized redirect URI:
   - `http://localhost:8787/auth/google/callback`, for the local backend;
   - `https://foyer.<subdomain>.workers.dev/auth/google/callback`, for the household's Worker;
   - `https://preview-foyer.<subdomain>.workers.dev/auth/google/callback`, for the preview.
3. Set the client's id and secret in three places:
   - on the household's Worker, in its settings in the Cloudflare dashboard, or with `pnpm --filter @foyer/server exec wrangler secret put GOOGLE_CLIENT_ID`, then the same for `GOOGLE_CLIENT_SECRET`;
   - in the previews' base configuration, as the next section shows;
   - in `apps/server/.dev.vars`, for the local backend.

## Previewing a branch

`pnpm --filter @foyer/server preview` deploys the current checkout to the preview, at `https://preview-foyer.<subdomain>.workers.dev`. It deletes the preview first, so the preview starts with empty data. There is one preview at a time, and running the script on another branch replaces it. The preview has its own Durable Objects, so it never touches the household's data.

The script needs access to the Cloudflare account. On your computer, sign in once with `pnpm --filter @foyer/server exec wrangler login`. Agents use a token instead, as [`AGENTS.md`](../AGENTS.md) says.

The preview takes its secrets, `HOUSEHOLD_MEMBERS`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, from the previews' base configuration, set with `pnpm --filter @foyer/server exec wrangler preview base-config secret put <NAME>`.

## Which backend an app build calls

The web app calls the backend at the address it's served from. The iPad app calls the backend that `EXPO_PUBLIC_BACKEND_URL` names when the app is built, and the local backend when it's unset. To build the iPad app for the household, set it to the household's address, for example in `apps/client/.env.local`, which git ignores. A development build can point at the preview the same way.

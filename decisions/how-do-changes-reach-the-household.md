# How do changes reach the household, and how is a branch previewed?
Decided in #55 and #12

**Applies when:** deploying the backend, previewing a branch, adding an environment, changing how the backend is built, or choosing which backend an app build calls.

**Answer:**
- **Three environments:** the local backend, the household's Worker, and one preview of a branch.
- **Deploys:** Cloudflare's Workers Builds deploys the household's Worker on every push to `main`, with a token Cloudflare manages, so GitHub holds no Cloudflare secrets. Deploys don't wait for CI. The build settings live in the Worker's settings in the Cloudflare dashboard, and run the server's `deploy` script. Workers Builds' own preview builds are off.
- **The preview:** one at a time, at a fixed address, `preview-foyer.<subdomain>.workers.dev`. The server's `preview` script deletes it and creates it again from the current checkout, so it starts with empty data. It has its own Durable Objects, and takes the household's allowlist and Google client from the previews' base configuration. The owner runs it after `wrangler login`. Agents run it from a cloud session with a Cloudflare token saved on the cloud environment, and post its address on the pull request.
- **Which backend an app build calls:** the iPad app calls the one `EXPO_PUBLIC_BACKEND_URL` names when the app is built, or the local backend when it's unset. The web app calls the address it's served from, which is the backend's own (#11). Locally, the backend forwards the web app's pages to Expo's development server, so they share one address there too.

Serving the web app from the household's Worker and the preview is built by #11.

**Why:**
- Workers Builds needs no Cloudflare token in GitHub, and the owner prefers deploys that don't wait for CI, with builds managed in Cloudflare's dashboard.
- Google only accepts sign-in at addresses registered in advance, so the preview keeps one fixed address and there's one at a time.
- Branches may store data differently, so a preview starts empty instead of reading what another branch stored.
- The web app's session lives in a cookie, which only works when the web app and the backend share an address.

**Rejected:**
- Deploying from GitHub Actions with Wrangler. It needs a Cloudflare token stored as a repository secret, and the owner doesn't want deploys to wait for CI.
- Workers Builds' preview builds, which can only be on for every branch or off. Each branch would get its own address, where Google sign-in can't work.
- A preview for each pull request, for the same reason, and a preview deployed from a label on a pull request, where two labelled pull requests take turns overwriting it.
- A separate development environment deployed on every merge, which is one more Worker, with its own secrets, to keep.
- Releases the owner starts by hand. The household gets each change as soon as it merges.

# How do people sign in, and how long do they stay signed in?
Decided in #12, #25 and #8

**Applies when:** signing people in or out, checking who makes a call or opens the sync connection, storing anything about sessions, or asking Google for anything about a person.

**Answer:**
- **Everyone signs in with Google, through the Worker, the same way on the iPad and the web.**
  - The app opens the Worker's `/auth/google`, which sends the person to Google, asking only for their name and email. Calendar access is asked for separately, of the same Google account, when someone connects Google Calendar (`where-do-calendar-events-live.md`). Google returns to the same `/auth/google/callback` then.
  - Google returns to the Worker's `/auth/google/callback`. The Worker checks that the email is verified and on the allowlist, finds the member by their Google account or creates them, and starts a session.
  - **Web:** the Worker sets the session's cookie and returns to the app.
  - **iPad:** the app opens `/auth/google?app=ipad` in the system's sign-in sheet (`expo-web-browser`). The Worker returns to `foyer://signed-in` with a one-time code, valid for a minute, which the app exchanges for its session token.
  - **Refused:** someone not on the allowlist returns to the app with an error, and the app says that account isn't part of this household.
- **Sessions are stored in the household, and checked on every request.**
  - **Web:** an HttpOnly cookie, first-party because one Worker serves the web app and the backend (#11), and locally too.
  - **iPad:** a bearer token, kept in the Keychain (`expo-secure-store`).
  - Both are sent on every Connect call and when the sync connection opens.
  - Stored in the household's `sessions` table:
    - `id`: a UUID version 7;
    - `token_hash`: a SHA-256 hash of the token, which is 32 random bytes. The token itself is never stored;
    - `member_id`;
    - `created_at`;
    - `last_used_at`, updated at most once a day.
  - A session ends when the person signs out, after 90 days without use, or when their email leaves the allowlist. Every request checks the allowlist, so that takes effect at once.
  - Nobody can see sessions: they never leave the server.
- **Calls,** in `foyer.session.v1.SessionService`:
  - `FinishSignIn {code}` returns `{token, member}`. The iPad uses it to exchange its one-time code.
  - `GetSession {}` returns `{member}` for the signed-in person, or an unauthenticated error. The app asks for it on start.
  - `SignOut {}` ends the current session.
  - `member` is `foyer.member.v1.Member {id, name}`.
- **Locally, people can sign in without Google.** When `apps/server/.dev.vars` sets `DEV_SIGN_IN=1`, `/auth/dev?email=…` signs in as an email on the allowlist. The Worker only allows it on `localhost`, and deployments never turn it on. A real iPad, which can't reach `localhost`, signs in to the local backend with the one-time code that sign-in without Google gives the Mac for it, which `pnpm sign-in-ipad` shows as a QR code. The iPad's development build opens it as `foyer://dev/sign-in?code=…`, which release builds don't follow.

**Why:**
- One flow for both platforms, and no Google SDK in the app.
- Google's answer reaches the Worker directly, so nothing in the app can forge it, and the Worker needs no library to check Google's signature.
- Connecting Google Calendar can reuse the same flow to get calendar access, which the Worker needs for itself anyway.
- A stored session can be ended on its own, so one device can be signed out, and a copied token stops working once it is.
- Agents and automated checks can't sign in to Google.

**Rejected:**
- Google's sign-in SDK on the iPad and Google's sign-in button on the web, which return a token the Worker checks with a library such as `jose`. That's two flows and a third-party native module, and Google Calendar would still need the Worker's flow later.
- Signed tokens that the Worker checks without storing them. They need no lookup, but a single device can't be signed out, and a copied token works until it expires.
- No local sign-in, so every check of a signed-in view needs the owner to sign in by hand.

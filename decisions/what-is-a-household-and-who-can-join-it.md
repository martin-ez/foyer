# What is a household, and who can join it?
Decided in #54 and #155

**Applies when:** addressing the household's storage, adding an environment, deciding who may sign in, or storing or showing anything about the people in a household.

**Answer:**
- **One household per deployment.** The local backend, the household's Worker and the preview each hold exactly one household: one Durable Object, always addressed by the name `household`. Anyone else who wants Foyer deploys their own copy. The household stores no fields of its own until a feature needs one.
- **Who can join is an allowlist kept in a secret, `HOUSEHOLD_MEMBERS`: a JSON list of email addresses.**
  - It's set on the household's Worker, in the previews' base configuration, and locally in `apps/server/.dev.vars`, never in the repository.
  - Changing it takes effect at once, with no deploy.
  - A missing or malformed list lets nobody in.
  - Removing an email stops that person signing in. Their member record and everything they made stay. The household disconnects their Google account and hands the shared spaces' calendars they held to a remaining member (`where-do-calendar-events-live.md`).
- **A member is a person who has signed in at least once.** Members are stored in the household's SQLite storage, in `members`:
  - `id`: Foyer's own id for the person. Everything else refers to members by it.
  - `email`: the Google address they signed in with, which must be on the allowlist.
  - `google_subject`: Google's stable account id, so a member stays the same person if their address changes.
  - `name`: their first name from Google, taken when they join.
  - `joined_at`: when they first signed in.
- **Members are created on first sign-in, not from the allowlist.** The allowlist says who may join; a member exists once they have.
- **Every member sees every member's id and name.** Emails and Google account ids never leave the server.

**Why:**
- Foyer is built for one household. Anyone else deploys their own copy, so nothing needs a sign-up flow or a directory from each email to its household.
- A household's members rarely change, so a secret the owner edits needs no screens to manage members and no admin role.
- An email address can change, and kids' accounts (#45) may not have a Google account at all, so members are referred to by Foyer's own id.

**Rejected:**
- Many households in one deployment, which needs a sign-up flow and a directory from each email to its household.
- An allowlist stored in the household and managed in the app, which needs screens to manage members and an admin role.
- Referring to members by their email.

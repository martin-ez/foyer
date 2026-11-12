# Google Calendar integration

Research from 2026-11-11, gathered while shaping the Foyer restart. Foyer
integrates with Google Calendar instead of rebuilding a calendar: family events
appear as stickers on Foyer's pages, and people may create or move events from
Foyer. This note covers access, syncing, the household model and the gotchas.
It is background for implementation, not a decision record. Items marked
*(unverified)* need testing.

## Summary

- **Foyer has to build its own tasks:** Google Tasks can't share lists.
- **The Google app must run "In production, unverified".** "Testing" mode
  breaks calendar access every 7 days.
- **Syncing needs a small server.** Firebase's free Spark plan can't run one;
  a Cloudflare Worker on the free plan can.
- **The research leans toward one "hub" Google account** that family members
  share their calendars with. That's a product decision still to make.

## Access (OAuth) for a private app

- **User type:** "Internal" needs a Google Workspace or Cloud Identity
  organization. Family members on ordinary Gmail accounts can't use it, so
  Foyer must be **External**.
- **Testing mode:** up to 100 test users, and every grant expires 7 days after
  consent. The only exception is apps that ask for sign-in identity alone, so
  the expiry applies to every Calendar scope. An always-on display would lose
  access every week.
- **In production, unverified:**
  - Allowed under Google's personal-use exception (fewer than 100 users).
  - Each person clicks past an "unverified app" warning once.
  - The app is capped at 100 new users over its lifetime.
  - *(Unverified)* Google only documents the 7-day expiry for Testing.
    Community reports say production tokens stop expiring, but Google doesn't
    say so for unverified apps with sensitive scopes. Confirm early with a
    token that still refreshes after 8+ days.
- **Classification:** no Calendar scope is "restricted" (that list covers Gmail,
  Drive, Fit, Chat and Health), so no paid security assessment is ever needed.
  Calendar scopes are "sensitive". Verifying them would need a verified domain,
  a public home page and privacy policy, a demo video and a reason for each
  scope. It takes about 10 days, with no fee mentioned.
- **Scopes:**
  - `events.owned` covers only calendars the user owns, not calendars shared
    with them.
  - `app.created` can't change sharing; that needs `calendar` or
    `calendar.acls`.
  - Listing a person's calendars needs a `calendarlist` scope.
  - **Best minimal fit:** `calendar.calendarlist.readonly` + `calendar.events`.
  - *(Unverified)* the exact classification of `calendarlist.readonly` and
    `app.created`; the Cloud console's Data Access page shows it.
- **Partial consent:** people can untick individual scopes, so Foyer must check
  what was actually granted.

## Syncing

- **Sync tokens:**
  - A full `events.list` returns a `nextSyncToken` on its last page.
  - Later calls with that token return only changes, deletions included.
  - Tokens can't be combined with time ranges, search or ordering filters.
  - A `410 Gone` means: wipe the stored events and sync again from scratch.
- **Push (`events.watch`):**
  - One channel per calendar, sent to a public HTTPS endpoint.
  - A notification only says something changed; Foyer then runs a sync.
  - Channels last about 7 days and must be renewed.
  - Google says delivery is "not 100% reliable", so periodic syncing is needed
    anyway.
- **Quotas:** 10,000 requests per minute per project, 600 per minute per user,
  1M per day without billing. Google plans charges above the limits later in
  2026, with 90 days' notice. A household polling 15 calendars every 5 minutes
  makes about 4,300 requests a day.
- **Simplest reliable pattern:** a server-side job every 2–5 minutes using sync
  tokens. Add push later only if a few minutes of delay matters.

### Where it can run on free tiers

| Option | Works? | Why |
|---|---|---|
| Cloudflare Workers (free) + D1 | Yes | 100,000 requests/day; scheduled jobs; time spent waiting on the network doesn't count toward the 10 ms CPU limit; 50 outbound calls per run. D1: 5M reads, 100k writes per day, 5 GB. Google secrets in Worker secrets, refresh tokens encrypted in D1 |
| Firebase Spark | No | No Cloud Functions or App Hosting, so nothing can hold refresh tokens or receive push. Firebase Auth's Google sign-in gives an access token, not a refresh token for Google APIs |
| Client-side only | Poorly | Browsers get short-lived tokens renewed only by a user action; native apps can keep access on the device, but every device needs every person's grant, and there's no push |

## Household model

| Option | How it works | Trade-offs |
|---|---|---|
| **Google family group calendar** | Created automatically; every member can edit; the family manager owns it | At most 6 people *(third-party sources)*; not available to work or school accounts; someone who leaves loses access; only shows events put there |
| **Each member connects their account** | Each person grants Foyer access to their own calendars | Most complete view; several consents and tokens to keep alive; Foyer sees private event details; more syncing |
| **One hub account** | Members share calendars with one account in Google's settings; the hub owns a writable Family/Foyer calendar | One token; members control sharing in Google; calendars shared as free/busy only show busy blocks |

**Ownership change (Nov 2025):** each secondary calendar now has one owner, and
calendars whose owner account is deleted are being removed during 2026. A
shared Foyer calendar must belong to an account that will last.

## Tasks

Google Tasks can't be shared through the API:
- A task list is only an id, title, etag and update time.
- Every method acts on the signed-in user's own lists.
- "Assigned" tasks come only from Docs or Chat and are read-only.
- `due` holds a date only (the time is dropped), with no reminders or
  recurrence.

**Foyer should build its own tasks.**

## Other calendars

- **iCloud:** no OAuth and no REST API; CalDAV at `caldav.icloud.com` with an
  app-specific password *(third-party sources)*. Those passwords need
  two-factor authentication, are capped at 25, and are revoked when the Apple
  ID password changes. No push, so polling. On Apple devices, EventKit reads
  every calendar account set up on the device.
- **Microsoft Graph:** OAuth for personal and work accounts, with delta queries
  and change notifications, so the same shape as Google.
- **Verdict:** keep a thin internal interface (list calendars, changes since a
  cursor, create or move an event) and don't build a second provider now.

## Gotchas

- Leaving the app in Testing breaks the integration weekly.
- Refresh tokens die after 6 months unused or when access is revoked. Each
  Google account holds at most 100 tokens per client, and the oldest is
  silently invalidated beyond that. Foyer needs a "Reconnect Google" flow for
  `invalid_grant` errors.
- Token refreshes plus paging across many calendars can hit the Worker's 50
  outbound calls per run; spread calendars across runs.
- Push needs a public HTTPS endpoint (`workers.dev` qualifies) renewed at least
  weekly. *(Unverified)* whether the webhook domain must be verified with
  Google.
- Supervised kids' accounts need a parent's approval to grant third-party
  access *(unverified for Calendar)*.
- Never store refresh tokens anywhere a client can read them, such as
  Firestore.

## Sources

- https://developers.google.com/identity/protocols/oauth2
- https://support.google.com/cloud/answer/15549945
- https://support.google.com/cloud/answer/7454865
- https://support.google.com/cloud/answer/13464323
- https://support.google.com/cloud/answer/13464325
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
- https://developers.google.com/workspace/calendar/api/v3/reference/acl/insert
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/guides/push
- https://developers.google.com/workspace/calendar/api/guides/quota
- https://developers.google.com/workspace/calendar/api/releases
- https://workspaceupdates.googleblog.com/2025/11/secondary-calendar-management-with-dedicated-owners.html
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/tasks/reference/rest/v1/tasks
- https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists
- https://support.google.com/calendar/answer/7157782
- https://support.google.com/families/answer/7251139
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/auth/web/google-signin
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://support.apple.com/en-us/102654
- https://learn.microsoft.com/en-us/graph/outlook-calendar-concept-overview
- Lower confidence (third-party): https://cli.nylas.com/guides/icloud-caldav-settings, https://github.com/agilityengineers/SmartScheduler/pull/50, https://www.unipile.com/google-oauth-refresh-token/

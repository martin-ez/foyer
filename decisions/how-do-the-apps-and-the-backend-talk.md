# How do the apps and the backend talk to each other?
Decided in #6, #22 and #62

**Applies when:** adding or changing a message, field or call that the apps and the backend send each other or store, or deciding how an app asks the backend for something or changes household data.

**Answer:**
- **Contracts are written in Protocol Buffers**, in `.proto` files in `packages/shared/proto`. protobuf-es generates the TypeScript for the iPad app, the web app and the Worker. Buf checks the contracts on every pull request with its standard lint rules, its formatting and a breaking-change check against `main`, which enforces:
  - Fields are added, never renumbered, renamed or reused.
  - A removed field's number and name stay reserved. The name counts because calls can travel in JSON, which uses names.
  - Calls, services and packages are never removed, because an older app may still make them.
- **Request/response calls use Connect RPC**, for what happens outside a household's sync, such as signing in, connecting Google Calendar, search, uploading images and the backend's status. Calls are declared as services next to the messages in the contracts. The generated code gives the iPad and web apps a typed client, and the Worker a typed handler. Calls travel as plain HTTP POST, in JSON or binary.
- **Changes to household data go through the sync protocol, even when they look like a request.** A quick capture in the app is a change pushed through sync, like a stroke. The answer comes back as the change being committed or refused, not as a reply.
  - **The one exception is a capture from an iOS Shortcut,** `foyer.capture.v1.CaptureService.Capture`, a call that adds a task to the Inbox of the member whose capture key it carries. The household makes the change as if their device had pushed it, and devices receive it through sync (`how-do-tasks-work.md`).

**Why:**
- The iPad app is reinstalled at most every 7 days, so it can run behind the backend. Buf's breaking-change check catches a change to a message or a call that an older app or stored data can't read.
- The binary encoding keeps strokes compact: about 1 KB each in #4.
- Connect's calls are plain HTTP, so they work in browsers, React Native and on Workers.
- A change that goes through sync waits in the same offline queue as every other change, reaches every device the same way and is safe to resend.
- A Shortcut has no sync connection and no offline queue to share, so going through sync gives it nothing, and Connect's calls are plain HTTP that the Shortcuts app can send.

**Rejected:**
- TypeScript types checked at runtime with a library such as Zod. JSON on the wire makes strokes larger, nothing checks that older apps still match, and any non-TypeScript code would need its own copy.
- Plain HTTP endpoints, where each client call and its errors would be written by hand and nothing would check that an older app still matches.
- Request/response calls for the apps' own actions, such as quick capture in the app, which would mean building offline queuing and resending a second time.

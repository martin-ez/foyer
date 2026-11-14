# How are the contracts between the apps and the backend written?
Decided in #62

**Applies when:** adding or changing a message, field or call that the apps and the backend send each other or store.

**Answer:** In Protocol Buffers, in `.proto` files in `packages/shared/proto`. protobuf-es generates the TypeScript for the iPad app, the web app and the Worker. Buf checks the contracts on every pull request with its standard lint rules, its formatting and a breaking-change check against `main`, which enforces:
- Fields are added, never renumbered, renamed or reused.
- A removed field's number and name stay reserved. The name counts because calls can travel in JSON, which uses names.
- Calls, services and packages are never removed, because an older app may still make them.

**Why:** The iPad app is reinstalled at most every 7 days, so it can run behind the backend. Buf's breaking-change check catches a change that an older app or stored data can't read. The binary encoding keeps strokes compact: about 1 KB each in #4.

**Rejected:** TypeScript types checked at runtime with a library such as Zod. JSON on the wire makes strokes larger, nothing checks that older apps still match, and any non-TypeScript code would need its own copy.

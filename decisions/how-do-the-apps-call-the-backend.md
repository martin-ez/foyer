# How do the apps call the backend?
Decided in #6

**Applies when:** an app needs something from the backend outside a household's sync, such as signing in, connecting Google Calendar, search, uploading images or the backend's status; or an app changes household data, even with something that looks like a request, such as a quick capture.

**Answer:**
- **Request/response calls use Connect RPC.** Calls are declared as services next to the messages in the contracts. The generated code gives the iPad and web apps a typed client, and the Worker a typed handler. Calls travel as plain HTTP POST, in JSON or binary.
- **Changes to household data go through the sync protocol, even when they look like a request.** A quick capture is a change pushed through sync, like a stroke. The answer comes back as the change being committed or refused, not as a reply.

Household changes going through sync is built by #14.

**Why:** Plain HTTP calls work in browsers, React Native and on Workers, and Buf's breaking-change check covers the calls as well as the messages, so an older iPad app keeps working. A change that goes through sync waits in the same offline queue as every other change, reaches every device the same way and is safe to resend.

**Rejected:** Plain HTTP endpoints, where each client call and its errors would be written by hand and nothing would check that an older app still matches. Request/response calls for actions such as quick capture, which would mean building offline queuing and resending a second time.

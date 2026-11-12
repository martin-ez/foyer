# How are the contracts between the apps and the backend written?
Decided in #10

**Applies when:** adding or changing anything the apps and the backend exchange: data types, sync messages or calls.

**Answer:** As one shared set of Protocol Buffers (`.proto`) files: the data types (including the ink format), the sync messages and the request/response services. Every part generates its code from them. How request/response calls travel is still open (#6).

**Why:** A single typed contract keeps the iPad, the phones, the web and the backend in agreement, and makes a breaking change visible in review rather than in production.

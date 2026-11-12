# How do two people edit the same text?
Decided in #51

**Applies when:** editing typed text while someone else might be editing the same page.

**Answer:** A text block is locked while someone edits it, and nobody else can change it until the lock is released. A lock expires on its own after a short silence, so a device that disconnects can't keep a block locked. Others can see that someone is writing there. Locks are per block, so two people can edit different blocks of the same group.

**Why:** Merging simultaneous edits to the same text is the hard case of collaborative editing. For a household, locking avoids it at almost no cost to how Foyer feels.

**Rejected:** Merging concurrent text edits (operational transformation or a text CRDT), which is complex. Last writer wins on a whole block, which silently loses someone's text.

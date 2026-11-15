# Who can see what?
Decided in #10 and #13

**Applies when:** creating an item or a space, moving an item between spaces, deciding which devices receive a change, or designing anything about sharing or privacy.

**Answer:** Spaces decide. Every task, event and note lives in exactly one space, and the space decides who can see and change what's in it: every member who can see a space can edit its items. There are no per-item rules. Moving an item to another space changes who sees it.

There are three kinds of space:
- **The Inbox:** each member has exactly one, private to them. It holds their quick captures until they file them into another space, which moves them as any move between spaces does. It's made when they join, has no name, and can't be created, renamed or deleted.
- **Personal spaces:** only their owner sees them. A member can have several, each with a name, such as "Work" or "Garden plans". Each member gets one named "Personal" when they join, which they can rename. Only the owner can rename a personal space.
- **Shared spaces:** every member of the household sees them, including members who join later. Any member can create or rename one.

So a member sees the shared spaces, their own Inbox and their own personal spaces. Someone who can't see an item still sees its stickers, with their contents hidden (`what-is-a-sticker.md`).

Spaces are stored in the household's `spaces` table:
- `id`: a UUID version 7, made by the device that creates the space, or by the server for the Inbox and the "Personal" space it makes when someone joins.
- `kind`: `inbox`, `personal` or `shared`.
- `owner_id`: the member whose Inbox or personal space it is. Empty for shared spaces.
- `name`: empty for the Inbox.
- `created_by` and `created_at`.

Devices create and rename spaces through sync, with `SpaceCreate` and `SpaceRename`, and the rename made last wins, by the device's clock. Devices receive the spaces they can see as `Space`. Sync is built by #14.

Ink on calendar pages is the one exception: it's always shared with the whole household, even though the stickers under it keep their own space's visibility. Private handwriting belongs in a personal notebook or an item's body page.

**Why:**
- One rule per container is easier to understand and to enforce than permissions on every item.
- For a household of a few people, "shared" means shared with the household. A shared space's audience never changes, so sync never has to send a space's whole history to someone newly added, or take it back from someone removed.
- Several personal spaces let a person keep their own projects apart.
- An Inbox of its own keeps unfiled captures out of every view of a personal space, and keeps every item in exactly one space.
- The calendar is the household's shared board, like one on the fridge, and keeping its ink in one shared layer avoids the scope of separate boards or layers.

**Rejected:**
- Per-item visibility, which may be useful later but adds complexity now.
- Chosen members for each shared space, changeable later. Each change to the members means sending or removing everything in the space on their devices. A list of chosen members can still be added as an optional field, where no list means everyone, with no migration.
- One personal space for each person, which can't keep a person's projects apart.
- Captures stored in the person's personal space with an "unfiled" mark, which every view of that space would have to leave out.
- A separate calendar board per person or space, which means hopping between boards.
- Stacked transparent ink layers per space, which is more scope.

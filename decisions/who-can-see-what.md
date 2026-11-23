# Who can see what?
Decided in #10, #13, #30, #98 and #72

**Applies when:** creating, archiving or restoring a space, creating an item or moving it between spaces, deciding which devices receive a change, or designing anything about sharing or privacy.

**Answer:** Spaces decide. Every task, event and note lives in exactly one space, and the space decides who can see and change what's in it: every member who can see a space can edit its items. There are no per-item rules. Moving an item to another space changes who sees it.

There are three kinds of space:
- **The Inbox:** each member has exactly one, private to them. It holds their quick captures until they file them into another space, which moves them as any move between spaces does. It's made when they join, has no name, and can't be created, renamed or deleted.
- **Personal spaces:** only their owner sees them. A member can have several, each with a name, such as "Work" or "Garden plans". Each member gets one named "Personal" when they join, which they can rename. Only the owner can rename a personal space.
- **Shared spaces:** every member of the household sees them, including members who join later. Any member can create or rename one.

So a member sees the shared spaces, their own Inbox and their own personal spaces. Someone who can't see an item still sees its stickers, with their contents hidden (`what-is-a-sticker.md`).

A finished space is archived, and can be restored. Deleting a space for good isn't offered.
- **Who:** any member archives or restores a shared space, and only its owner a personal space, as for renaming. The Inbox can't be archived.
- **Where it goes:** an archived space and its items leave every list and space picker, for everyone who sees it, until it's restored. Its items, pages, ink and stickers are all kept, and devices keep receiving them, so restoring is instant.
- **Read-only:** the household refuses every change inside it, saying "This space is archived. Restore it to change it.": changes to its items, creating items in it or moving them in or out, placing, moving or removing its items' stickers on any page, making its pages and its items' pages, writing on them, and renaming it. A change in an archived space someone doesn't see is refused as for any space they don't see.
- **Calendar pages:** its items' stickers stay where they are, so the calendar keeps its history and the ink around them still makes sense. They open read-only and can't be moved. Ink and text on calendar pages stay the household's, and can still change around them.
- **Its Google calendar** stays in Google, and the household stops reading and writing it until it's restored (`where-do-calendar-events-live.md`).
- **Names:** an archived space's name still counts. Creating a space with its name numbers the new one, and a rename to it is refused, saying "An archived space is called “Home”." Restoring never renames anything.

Spaces are stored in the household's `spaces` table:
- `id`: a UUID version 7, made by the device that creates the space, or by the server for the Inbox and the "Personal" space it makes when someone joins.
- `kind`: `inbox`, `personal` or `shared`.
- `owner_id`: the member whose Inbox or personal space it is. Empty for shared spaces.
- `name`: empty for the Inbox.
- `created_by` and `created_at`.
- `archived`, with `archived_at` and `archived_change_id`, the time and id of the change that last archived or restored it.

Devices create, rename, archive and restore spaces through sync, with `SpaceCreate`, `SpaceRename` and `SpaceSetArchived {space_id, archived}`, and the rename, or the archiving or restoring, made last wins, by the device's clock. Devices receive the spaces they can see as `Space`, with `archived` (`how-do-devices-stay-in-sync.md`).

A space's name follows these rules, which the household applies to `SpaceCreate` and `SpaceRename`, and the app applies too, so a person learns about a problem before they save:
- **Trimmed:** spaces at its start and end are dropped before it's checked or stored.
- **Not blank, and at most 120 characters**, counted as Unicode code points. Anything else is refused, and the app stops typing at 120.
- **Unique among the spaces the person making the change sees:** every shared space and their own personal spaces, archived ones included, ignoring case, so "home" clashes with "Home". Other members' personal spaces don't count, so a member may see their personal "Home" next to a shared "Home" someone else created.
- **A create that clashes is numbered, not refused,** because a space created offline may already hold items. The household adds the first free number, as in "Groceries 2", shortening the name before the number if it would pass 120 characters, and the device receives the space under that name. The "Personal" space a member gets when they join is numbered the same way.
- **A rename that clashes is refused**, and the device undoes it. A space can take its own name in another case. A rename that loses to one made later has no effect and isn't checked.

Ink and typed text on calendar pages are the one exception: they're always shared with the whole household, even though the stickers under them keep their own space's visibility. Private handwriting belongs in a personal notebook or an item's body page.

**Why:**
- One rule per container is easier to understand and to enforce than permissions on every item.
- For a household of a few people, "shared" means shared with the household. A shared space's audience never changes, so sync never has to send a space's whole history to someone newly added, or take it back from someone removed.
- Several personal spaces let a person keep their own projects apart.
- Unique names keep spaces apart in every list a person sees, without revealing anyone's private spaces.
- An Inbox of its own keeps unfiled captures out of every view of a personal space, and keeps every item in exactly one space.
- The calendar is the household's shared board, like one on the fridge, and keeping its ink in one shared layer avoids the scope of separate boards or layers.
- Archiving a finished space tidies every list without losing what was in it, and can be undone. Keeping it read-only means restoring brings back exactly what was archived, and an archived space's stickers on calendar pages keep the calendar's history as it was. Counting archived names means restoring never has to rename anything.

**Rejected:**
- Per-item visibility, which may be useful later but adds complexity now.
- Duplicate space names, which the owner wants unique among what each person sees.
- Refusing a create whose name clashes, which would refuse the items added to the space offline along with it.
- Checking a name against every member's personal spaces, which would reveal that a private space's name exists.
- A limit of 60 characters on names, or none.
- Chosen members for each shared space, changeable later. Each change to the members means sending or removing everything in the space on their devices. A list of chosen members can still be added as an optional field, where no list means everyone, with no migration.
- One personal space for each person, which can't keep a person's projects apart.
- Captures stored in the person's personal space with an "unfiled" mark, which every view of that space would have to leave out.
- A separate calendar board per person or space, which means hopping between boards.
- Stacked transparent ink layers per space, which is more scope.
- Deleting a finished space for good, which can't be undone. It can come later, beside archiving.
- An archived space that can still be changed, which would change things nobody sees in any list.
- Taking an archived space's stickers off calendar pages, which would leave the ink written around them without its context.

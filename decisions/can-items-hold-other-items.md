# Can items hold other items?
Decided in #80 and #60

**Applies when:** putting an item under another, showing or listing items with items under them, ticking, moving or deleting an item that holds others, or adding a kind of item.

**Answer:**
- **What can nest:** tasks and notes can hold items, and any item can sit under one, events included. A "Birthday party" task can hold the party's event, a shopping list and a note of ideas. Items nest as deep as people like: the data is the same at any depth, and the views decide how much to show.
- **Where children live:** an item always lives in its parent's space. Children move with their parent, and whoever sees the parent sees everything under it. Putting an item under a parent in another space moves it into that space, which is refused when it holds an occurrence of a repeating event, as such an occurrence moves only with its series (`where-do-calendar-events-live.md`).
- **Where children show:** each child is a sticker on its parent's body page, placed below the last one like tasks on a space's page, so people can write around them. The body page is made when the first child is added. A space's page shows only its top-level items. Lists show children indented under their parent.
- **Ticking** a parent with open tasks under it asks first whether to tick them too. Each task ticked keeps its own completion record (`how-do-tasks-work.md`).
- **Deleting** a parent with items under it asks first: delete them too, move them up to the parent's own parent, or move them to the top of the space.
- **Storing and syncing:**
  - Each item has an optional `parent_id` (`what-is-an-item.md`).
  - `ItemSetParent {item_id, parent_id}` puts an item under a parent, or back at the top of its space when `parent_id` is empty. The change made last wins (`how-do-devices-stay-in-sync.md`).
  - The household refuses a change that would put an item under itself or under one of its own children. Two devices offline could otherwise make a loop, each moving one item under the other.
  - Moving a parent to another space moves everything under it, and sync sends or hides all of it.

Notes join in when they're built by #29, with the same rules.

**Why:** Breaking a task into smaller steps, next to a brainstorming note about it, is how people plan in Notion and Todoist. Children in their parent's space keep one rule for who sees what, so nobody sees a parent with children they can't open. Stickers on the parent's body page leave room to write around them, as on a space's page. Asking before ticking or deleting a parent keeps one tap from changing things the person can't see from where they are.

**Rejected:**
- Only tasks and notes, as parents and children.
- Children in any space, where some people would see a parent with children they can't open.
- A fixed limit, such as Todoist's four levels.
- Children shown only in lists.
- Ticking everything under a parent without asking, as in Todoist; and refusing to tick a parent until everything under it is done.
- Always deleting children with their parent, as in Todoist and Notion; and always moving them up.

# How is typed text stored and laid out?
Decided in #10 and #30

**Applies when:** storing, syncing, editing or drawing typed text on a page.

**Answer:** Typed text is made of Notion-style blocks (paragraphs, headings, lists), stored as Markdown. Blocks belong to text groups, which are positioned on the page with their own margins; within a group, blocks flow from the top down. A page can hold several groups, and groups can be moved, split and joined. Text starts top-left with normal margins, like a document. There are no columns, databases or other complex layouts.

- **Where text goes, and who sees it:**
  - Every page can hold text: notes' pages, task and event body pages, space pages and calendar pages.
  - Text belongs to its page, as ink does. Everyone who sees a page sees its text and can change it; on calendar pages, that's the whole household.
  - Devices hold all the text they can see, as they hold items, not page by page as for ink.
  - Deleting an item deletes the text on its pages with it, and moving an item to another space takes that text with it.
- **Text groups,** in the household's `text_groups` table and sent as `foyer.text.v1.TextGroup`:
  - `id`: a UUID version 7, made by the device.
  - `page_id`: the page it's on, which it never leaves.
  - `x`, `y`: its top-left corner, in points on the page. `width`: in points, which its text wraps within, no wider than the page. Its height comes from laying its text out, which is the same on every device, so it isn't stored.
  - `placed_at`, `placed_by`: the time and member of the change that made or last moved it, for stacking with stickers and strokes (`what-is-a-page.md`).
  - `created_by`, `created_at`.
- **Text blocks,** in `text_blocks` and sent as `foyer.text.v1.TextBlock`:
  - `id`: a UUID version 7, made by the device. Locks (`how-do-two-people-edit-the-same-text.md`) and ink that follows text (#42) refer to it.
  - `group_id` and `order`, which change together as one value. `order` is a string of 0-9, A-Z and a-z that never ends in 0, so another always fits between two, and adding a block never renumbers the others. Blocks are in the order of their `order`, compared character by character, with equal orders settled by id. At most 1,000 characters.
  - `markdown`: the block as one line of Markdown, of at most 10,000 Unicode code points:
    - its type as Markdown's prefix: none for a paragraph, `# `, `## ` or `### ` for headings, `- ` for a bulleted item and `1. ` for a numbered item, after two spaces for each level a list item is nested. Numbered items are numbered when drawn, so adding one renumbers nothing;
    - inside it, only `**bold**`, `*italic*` and `***both***`, each styled stretch marked on its own;
    - any other character Markdown would read as more is escaped with a backslash, so it reads as typed. The household refuses Markdown it wouldn't write that way, and line breaks: each paragraph is a block of its own.
  - `created_by`, `created_at`.
- **Changes:** `TextGroupCreate`, pushed with the group's first block, on a page that has been created; `TextGroupMove`, which brings it to the top; `TextGroupResize`; `TextGroupDelete`, which deletes its blocks with it; `TextBlockCreate`, `TextBlockEdit`, `TextBlockDelete`; and `TextBlockMove`, within its group or to another on the same page. Splitting a group is a new group and block moves, and joining two is block moves and deleting the emptied group, in one push. Each value keeps the time and id of the change that last set it, and the change made last wins (`how-do-devices-stay-in-sync.md`): a group's place, its width, a block's group and order, and a block's text.
- **How it behaves:**
  - A device sends a block's text when typing pauses for a second and when the person leaves the block, not on every key, since every message counts against the free plan's daily requests.
  - Text is read-only while the device isn't up to date with the household.
  - Page text keeps its size on the page, like paper, and people zoom to read it. It doesn't follow the system's text size, which would break identical layout. A screen reader reads each group through an accessibility element over it.
  - A group that grows past the bottom of its page is cut off there and marked, and people move, narrow or split it.
- **Drawing:** Skia lays text out once, in page points, and only scales the drawing to zoom (#3). Text is drawn in IBM Plex Sans, bundled with the apps, and emoji in Noto Color Emoji, bundled too and loaded only when a page's text has emoji, so emoji lay out the same everywhere. Both are under the SIL Open Font License. Which fonts is a design choice.

Locks while someone edits a block are built by #51; until then, the edit made last wins on a whole block.

**Why:** Markdown keeps text simple and portable, and blocks make it easy to switch a line between types. Positioning groups on the page keeps text as tangible as everything else, and lets ink drawn over a block stay with it. Text must lay out identically on every device so ink stays aligned with it. Orders that fit between each other let two devices add blocks offline without renumbering anything. Escaping everything else keeps what someone typed as they typed it, and one way of writing each block means the household can check it. Text is small, so holding it all lets notes and search (#36) work without opening each page. Sending on a pause keeps typing within the free plan's requests.

**Rejected:** A flowing, scrolling document with ink on top, where ink drifts away from the text it refers to. Notion's columns and databases, which add complexity Foyer doesn't need. Numbering blocks with integers, which renumbers the blocks after an insert and clashes when two devices insert offline. Sending text on every key. Text that follows the system's text size. The system's emoji fonts, which differ between the iPad and the web and change line breaks (#3).

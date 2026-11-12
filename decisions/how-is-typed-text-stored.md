# How is typed text stored and laid out?
Decided in #10

**Applies when:** storing, syncing, editing or drawing typed text on a page.

**Answer:** Typed text is made of Notion-style blocks (paragraphs, headings, lists), stored as Markdown. Blocks belong to text groups, which are positioned on the page with their own margins; within a group, blocks flow from the top down. A page can hold several groups, and groups can be moved, split and joined. Text starts top-left with normal margins, like a document. There are no columns, databases or other complex layouts.

**Why:** Markdown keeps text simple and portable, and blocks make it easy to switch a line between types. Positioning groups on the page keeps text as tangible as everything else, and lets ink drawn over a block stay with it. Text must lay out identically on every device so ink stays aligned with it.

**Rejected:** A flowing, scrolling document with ink on top, where ink drifts away from the text it refers to. Notion's columns and databases, which add complexity Foyer doesn't need.

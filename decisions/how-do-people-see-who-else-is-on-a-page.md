# How do people see who else is on a page?
Decided in #58

**Applies when:** showing who else is on a page or where they point, or changing how a person is shown live, such as their colour, their initial, or when their marker appears and goes. What devices send for it is `what-does-the-live-lane-send.md`.

**Answer:**
- **Who is shown:** the other members on the page you're on. Where people are elsewhere isn't shown, and you never see yourself, even from another of your devices.
- **How a person is shown:** a marker with their first-name initial, in a colour worked out from their member id, so it's the same on every device and nothing new is stored. The iPad and the web app work it out with the same code, and changing how changes everyone's colour. The design milestone can change the look, and a colour people choose can be added later as an optional field.
- **Where:** where they point on the page: a finger, the Pencil touching or hovering, or a mouse on the web. Markers are drawn in the page's own coordinates, so they stay on the same spot of paper at any zoom.
  - The marker glides to each new position, which arrive up to 4 times a second.
  - When they stop moving, the marker stays where they last pointed.
  - Before they first point, it waits at the page's top edge, beside anyone else who hasn't pointed. It goes back there once the household's daily limit for positions is reached.
  - The hovering Pencil isn't followed yet: #126.
- **Leaving:** leaving the page, or putting the app in the background, removes their marker at once.
- **Lost connections:** a dropped connection removes the marker after about a minute without the keep-alive, so short drops don't make people flicker.

**Why:**
- Presence is the first taste of Foyer's multiplayer feel, before live sticker drags (#38) and live strokes (#43) build on it, so it shows where people are, not only that they're there.
- An initial and a colour worked out from the member's id need no stored field and no setting.
- Markers in page coordinates point at the same thing on every device, whatever each person's zoom.

**Rejected:**
- A strip showing who's in Foyer now and where, which is more to design and show.
- Google profile photos, which would store a photo address for each member.
- A colour each member picks, which needs a stored field and a setting.
- Markers along the page's edge only, which would have cost less but don't show where people are.
- Fading a marker when someone stops moving.

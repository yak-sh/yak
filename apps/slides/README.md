# Slideshow

A slideshow of a person's own photos and words, for the screen at a shop, a
stall or an event, or a link sent to people. The owner and editors add and order
the slides; anyone with the link watches. It plays full screen, moving on by
itself or by tap, swipe or arrow key, and keeps the screen awake. A slide
changed from a phone shows on the screen playing it a moment later, because the
page draws everything from one subscription.

A slideshow is `show{seconds, look}`, named by its `doc.title`. A slide is
`slide{show, ord, photo, layout}`, its heading and words in `doc`; `photo` is
the uploaded picture's eid, made at most 2,048 pixels across on the page before
it is sent. A slide sizes its type in container units, so a card, a thumbnail
and the full screen draw the same markup.

`show.js` holds the logic (order, moving, going round, sizes), `ui.js` the
dialog and the foot, `app.js` the page and the player.

The demo at https://yourname.yaks.app/slides/ holds Wren's Bakery's slideshow
for its market stall, with CC0 photos from Wikimedia Commons, written into its
store; an installed copy starts empty. Run `deno task test apps/slides` for the
logic.

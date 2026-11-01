# Handouts

A school's handouts on yaks.app, for athletes, parents and coaches: each one is
written on the page, attached as a file, or both. Anyone with the link reads,
prints and downloads; the owner and editors add and change them. A link to one
handout is what a coach sends to a team chat.

A handout is `handout{audience, team, file, name, mime, bytes}` with its title
and text in `doc`. `file` is the eid of the uploaded bytes, read from
`./api/blob/<file>`. The text is plain: a blank line starts a paragraph, `##` a
heading, and `-` or `1.` a list.

`handout.js` holds the logic (order, sizes, the text as a page), `ui.js` the
dialog and the foot, `app.js` the page. A handout's text is kept as a draft
until saved.

The demo at https://yourname.yaks.app/handouts/ holds eight handouts and three
PDFs written into its store; an installed copy starts empty. Run
`deno task test apps/handouts` for the logic.

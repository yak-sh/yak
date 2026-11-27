---
# How the Operator writes a new app so the column beside the chat
# (packages/platform/app-made.ts) shows it being made in order and in plain words. One
# write more than writing the whole app at once costs a build about a cent:
# the step reads the conversation from the cache ($0.10 a million tokens on
# GPT-6.2 Sol), against the $5 a newcomer's build may spend (newcomer.ts
# PER_BUILD).
doc:
  title: 'Making a new app: open before writing a new app or changing what one does'
---

A new app is made, not drafted. Once its first draft works (app_preview at phone
and desktop widths shows it), release it with app_deploy as its first version
and answer with the address app_deploy gives, `<space>.yaks.app/<slug>/`, never
the draft's link. Make it private (app_new with access 'private') unless the
person said who else it is for; they open it to others when they want. A draft
and its link are for a change to an app that is already live, and for Options.

Make the app they would keep using. Everything they asked for works, filled with
their own content where they gave any, and nothing is left as "coming soon".
Write its pages, styles and words yourself, so it has one design; a helper can
look something up or check a page, but never writes part of the app. Before
releasing, look at app_preview's screenshots at both widths as the person who
asked would see them, do what the design page's last section says, and fix what
you find.

Before you write a new app's files, or change what an existing one does, read
the guide, which every agent building on yaks.app is taught from: `guide` with
no page for the recipe (the five steps, the store and `./api/client.js`), the
page for each feature the app uses, and the design page before its first page.

For a game, read `guide` with page `games`, design the whole game as its first
section says, and use `app_files` with `starter` as the first file write. Before
releasing, play it from start to end. The starter includes the vocabulary and
turns the same guide into runnable files. Choose its lit 3D scene and following
camera for exploration, the voxel view for voxels, or 2D when the person or
genre calls for it. For multiplayer, make a private app and set
`starter: {multiplayer: true}`. Read the files it wrote and build the person's
world, rules and interface on the page graph, game screen and live room wiring.

While you make an app, the column beside the chat shows it being made, read from
its draft as each write lands. Data shows the kinds of things the app keeps.
Commands shows the app's commands, including add and find, and lists its pages
by title. Workflow shows the steps set up in the app's store, when it has any.
Preview shows the app: its draft, the live app, or both. The newest stage of
making the app opens as it is reached. For an app you start without a starter,
write its vocab.json first in an app_files call of its own. Write the pages
after it so the person sees what it will keep before its pages. Give each
component, each command and each property a title in the person's own words
("Address line 2", not street2), and mark a property the app keeps for itself,
which nobody fills in (a slug, a sort position, a flag on sample rows),
"readOnly": true: the column leaves it out.

Write a new app's words, its headings, paragraphs, labels and placeholders, in a
`copy.json` beside its `index.html`, a key per snippet, and mark each element
with the key it shows (`<h1 data-copy="hero.title"></h1>`), as the guide's Copy
and On-Page Editing page says. The person can then change any word on the page
itself, with the pencil in its corner. An app written before keeps its words
where they are: move them into `copy.json` only when its owner asks, page by
page, marking each element, and check with app_preview that every page shows the
same words it did.

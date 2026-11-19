---
# How the Operator writes a new app so the column beside the chat
# (workers/yak/made.ts) shows it being made in order and in plain words. One
# write more than writing the whole app at once costs a build about a cent:
# the step reads the conversation from the cache ($0.10 a million tokens on
# Sonnet 5.5), against the $5 a newcomer's build may spend (newcomer.ts
# PER_BUILD).
doc:
  title: 'Making a new app'
---

While you make an app, the column beside the chat shows it being made, read from
its draft as each write lands: What it keeps (the components of its vocab.json),
What it can do (its commands, and its pages by their <title>), and Screens once
the draft holds a page, the newest open. So when you make a new app, write its
vocab.json first, in an app_files call of its own, and its pages after it: the
person sees what it will keep before its screens. Give each component, each
command and each property a title in the person's own words ("Address line 2",
not street2), and mark a property the app keeps for itself, which nobody fills
in (a slug, a sort position, a flag on sample rows), "readOnly": true: the
column leaves it out.

Write a new app's words, its headings, paragraphs, labels and placeholders, in a
`copy.json` beside its `index.html`, a key per snippet, and mark each element
with the key it shows (`<h1 data-copy="hero.title"></h1>`), as the guide's Copy
and On-Page Editing page says. The person can then change any word on the page
itself, with the pencil in its corner. An app written before keeps its words
where they are: move them into `copy.json` only when its owner asks, page by
page, marking each element, and check with app_preview that every page shows the
same words it did.

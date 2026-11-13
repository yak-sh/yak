---
name: copy
description: "Copy and On-Page Editing (yaks.app). An app's copy, the words its pages show, kept in one file, copy.json, a key per snippet: nested objects and dotted keys, plain-text values, and named slots (%{name}) for a link or a bold word inside a sentence. Marking an element with data-copy, data-copy-<attr> for alt, placeholder, title, aria-label or a meta tag's content, and data-copy-slot; the platform fills each marked element as it serves the page, in previews too, and a key the file lacks leaves the element's own content. Text a script draws, read from ./copy.json and marked the same way. Editing the copy on the page: the pencil a member who writes the app sees, drafts kept as they type, and discarding them. Moving an existing app's text into copy.json when its owner asks."
---

# Copy and On-Page Editing

The map is at <https://yaks.app/docs.md>. This page covers an app's copy: the
file it is kept in, how a page names the snippets it shows, text a script draws,
and editing the copy on the page itself.

An app's **copy** is the words its pages show: headings, paragraphs, button
labels, placeholders, the page's title and description. Write a new app's copy
in `copy.json` rather than in its HTML and scripts. The person who owns the app
can then change any word where they see it, on the page, without asking you, and
a change of words never touches the markup.

## copy.json

`copy.json` sits at the app's root, beside `index.html`. It is a JSON object of
**snippets**, each a key and its text. A nested object reads as dotted keys, so
`cost.plans` is `{"cost": {"plans": "…"}}`, and a key written with its dots,
`{"cost.plans": "…"}`, reads the same. Group the keys by page and section:

```json
{
  "cost": {
    "title": "What it costs",
    "note": "A space is your address, like %{yours}, with its apps, their data and the people you invite.",
    "limits": "Tax is included. Going over a limit never deletes your apps or data. %{plans}.",
    "plans": "Compare plans and limits"
  }
}
```

Write it one snippet per line. When two people change different snippets, they
change different lines.

A snippet's value is plain text, never markup. A link, a bold word or any
element inside a sentence is a **slot**, `%{name}`, described below. `%%{name}`
is the literal text `%{name}`, and a lone `%` is a percent sign.

## Marking elements

An element names the snippet it shows with `data-copy`, and leaves its own text
out:

```html
<h2 data-copy="cost.title"></h2>
```

The platform fills each marked element from the release's `copy.json` as it
serves the page, so the page arrives with its words in it: a crawler, a link
preview and a page whose scripts have not run yet all read them. A preview of
the draft (`app_preview`) fills from the draft's `copy.json`.

An attribute whose value is words names its snippet with `data-copy-<attr>`:

| attribute                  | names                                                   |
| -------------------------- | ------------------------------------------------------- |
| `data-copy="<key>"`        | the snippet that is the element's text                  |
| `data-copy-<attr>="<key>"` | the snippet that is its attribute `<attr>`'s value      |
| `data-copy-slot="<name>"`  | the slot of its parent's snippet that the element fills |

`<attr>` is any attribute that holds words: `alt`, `placeholder`, `title`,
`aria-label`, or a meta tag's `content`.

```html
<title data-copy="page.title"></title>
<meta name="description" data-copy-content="page.description">
<input type="search" data-copy-placeholder="search.hint"
  data-copy-aria-label="search.label">
<img src="team.jpg" data-copy-alt="about.photo">
```

A key the file does not have leaves the element as it was written, its own text
and attributes standing. An app with no `copy.json` is served exactly as
written.

## Slots

A slot is a named part of a snippet that an element fills. The marked element's
child with `data-copy-slot="<name>"` takes the place of `%{name}`, and that
child can name a snippet of its own:

```html
<p data-copy="cost.limits">
  <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans"></a>
</p>
```

With the `copy.json` above, this is served as

```html
<p
  data-copy="cost.limits">Tax is included. Going over a limit never deletes your apps or data. <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans">Compare plans and limits</a>.</p>
```

The sentence stays one snippet, so whoever edits it can move the link within it,
and the link keeps its address and its own snippet. A slot with no child to fill
it is shown as its `%{name}`, so a missing part shows by name rather than as a
gap.

Use a slot for anything inside a sentence that is not plain text: a link, a
`<strong>`, a number the page computes (`<span data-copy-slot="count">`).

## Text a script draws

`copy.json` is served like any other file of the app, so a script that draws
text reads it from `./copy.json`. Mark what it draws with `data-copy` too, so
the words can be edited on the page:

```js ignore
let copy = await (await fetch('./copy.json')).json()
let text = (key) =>
  copy[key] ?? key.split('.').reduce((o, part) => o?.[part], copy)

let empty = document.createElement('p')
empty.dataset.copy = 'list.empty'
empty.textContent = text('list.empty')
list.append(empty)
```

Fetch it beside the page's other first reads, not after them
(<https://yaks.app/docs/speed.md>). A message built from data, such as "3 items
left", is a snippet with a slot, `"list.left": "%{count} items left"`, with the
number placed where the slot is.

Keep in code what is data rather than copy: what people saved in the app's
store, and words that come from it, are never in `copy.json`.

## Editing on the page

A member of the app's space who may write its files, an owner or an editor, sees
a pencil in the bottom-right corner of every page of the app. Nobody else is
sent it: not a visitor, not a guest.

1. Press the pencil to enter edit mode. Every marked element is outlined.
2. Click one and type over its text where it stands. Links and buttons do not
   act while editing, and a slot's own element is edited on its own.
3. Each change is kept as the person's draft of that snippet, `copy:<key>`, as
   it is typed: it is there after a reload and on their other devices. The
   pencil's panel counts the changes, "3 changes", and Discard empties them.
   Typing a snippet back to its original words removes that change. Edit mode
   stays on across a reload until Done.

A page with nothing marked says so, and offers to ask the Operator to move its
copy into `copy.json`.

## Moving an existing app's copy

An app written before `copy.json` keeps working as it is, and nothing moves it.
When its owner asks for its words to be editable on the page, move them:

1. Read the app back, `app_files(app, op: 'read')`.
2. For each page, give each piece of text a key named for its page and section,
   write it into `copy.json`, and mark its element with `data-copy`, removing
   the text from the element. A link or a bold word inside a sentence becomes a
   slot.
3. Mark attributes that hold words (`alt`, `placeholder`, `title`, `aria-label`,
   the page's `<title>` and description), and change each script that draws text
   to read `./copy.json`.
4. Check the draft with `app_preview` at both widths: every page shows the same
   words it showed before.
5. `app_deploy`.

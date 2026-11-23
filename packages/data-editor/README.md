# @yaks/data-editor

A store's rows as forms, from the words it declares. The data editor is the page
yaks.app serves for every app at `<app>/_web/data`; its pieces are exported so
an app can edit another store's rows the same way, such as the back office
(`apps/back-office`) over a shop's products.

| Export                     | What it offers                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/data-editor`        | `kinds(defs)`, `fields(name, def)`, `facts(name, def)`, `label`, `titleOf`, `readOnly`, and the `Kind`, `Field` and `Control` types: pure data from a vocabulary |
| `@yaks/data-editor/form`   | `drawForm`, `controls`, `valued`, `patch`, `title`, `described`, `stamp`, `notice`, `el`: the row form and its controls, drawn in a page's DOM                   |
| `@yaks/data-editor/editor` | `open({root, client, kinds, accepts, view, files})`: the data editor page                                                                                        |

## Kinds and fields

A **kind** is a component a store keeps rows of, with the query its rows answer
(`line`) and a **field** for each property a person writes. A field's
**control** is chosen from its declaration: a `ref` to `blob` is a file, any
other `ref` a pick among rows, an `enum` a choice, then number, yes/no, lines,
JSON, date and time, URL and text. A property the app keeps for itself
(`readOnly: true`) is shown and never edited; a stamped, computed or status
property is not a field at all. `facts` is every property of a component, each
shown and none edited: what a row holds, including what the platform keeps
there.

```ts
import { facts, fields, kinds } from '@yaks/data-editor'
import { equal } from '@yaks/testing'

let defs = {
  product: {
    properties: {
      price_cents: { type: 'integer' },
      image: { type: 'string', format: 'uri' },
    },
  },
}
equal(kinds(defs).map((k) => k.label), ['Product', 'Other rows'])
equal(fields('product', defs.product).map((f) => f.control), [
  'text',
  'text',
  'number',
  'url',
])
equal(facts('product', defs.product).every((f) => f.readOnly), true)
```

## The row form

`drawForm({doc, client, kinds, kind, row, who, desk, files, accepts, done,
redraw})`
answers the form a row of `kind` is added with (no `row`) or edited with.
`client` is a store's names: `./api/client.js`, or `store(base)` for another
app's store. `who` is its `me()`, and `desk` its `drafts()`, so what is typed
and not saved is kept as a draft and comes back on any device. It saves through
`client.apply`, writing only what changed (`patch`), and calls `done` once it
saved or deleted.

`controls({doc, client, kinds, files, accepts})` gives the parts the form is
made of: `drawValue(field, id, raw)` shows a value as words (a reference by its
row's name, a file by its link), `drawControl` draws a field's control, and
`drawField` either one with its label and hint.

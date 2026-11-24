---
doc:
  title: UI Kits
guide:
  slug: kits
  brief: an app's forms, lists, buttons and notices from @yaks/ui and @yaks/ux, in the app's own colours
  description: >-
    Building an app's screens from the platform's kits: @yaks/ui's parts
    (Card, Form, Button, Notice, Rows, Tile, Empty, Stamp, Meter, Tabs, Table
    and charts) and @yaks/ux's behaviour (Fields for labelled controls, Submit
    for a form whose typing is kept as a draft until it is saved and which says
    when a save failed). Naming them as platform dependencies in package.json,
    a TypeScript page module, dressing the page with wear(), giving the parts
    the app's own colours and type in the theme's custom property names, words
    from copy.json, and the visitors' book, a whole working example.
---

# UI Kits

A **kit** is a set of ready-made interface parts. yaks.app supplies two, as
platform dependencies (named `"platform"` in `package.json` instead of a
version):

- **@yaks/ui**: the parts a screen is drawn from, each a Preact component with
  its own stylesheet: `Card`, `Form`, `Button`, `Notice`, `Rows`, `Tile`,
  `Empty`, `Stamp`, `Meter`, `Tabs`, `Table` and more, and `@yaks/ui/chart` for
  sparklines and columns.
- **@yaks/ux**: behaviour over those parts. `Fields` draws labelled inputs, text
  areas, choices and checkboxes from a list of specs. `Submit` keeps what the
  person types in a form as a **draft** in the store until the store has saved
  it, so a half-written entry survives a reload, a second tab and another
  device, and a failed save keeps the entry and says why.

Build an app's forms and lists from the kits. An app that writes its own form
has to write its own fields, labels, buttons, saved and failed states and draft
keeping, and most leave some out; the kits have them once, for every app. The
parts take the app's own colours and type, so an app built on them still looks
like its subject (Colours and type, below).

What it costs: the page is a TypeScript module that `app_deploy` compiles, with
a `package.json`; and the screen is drawn by the module, so it appears once the
module and the kit's stylesheets have loaded. A page that is mostly reading (an
article, a menu, a landing page) gains little and stays plain HTML. A plain page
still keeps typed input with `drafts` from `./api/client.js`
(<https://yaks.app/docs/storage.md>, Keeping typed input).

Back to the map: <https://yaks.app/docs.md>. Compiling TypeScript and npm
imports: <https://yaks.app/docs/code.md>. The look of a page:
<https://yaks.app/docs/design.md>.

## The files

`package.json` names the kits and Preact:

```json
{
  "dependencies": {
    "@yaks/ui": "platform",
    "@yaks/ux": "platform",
    "preact": "^10.29.1"
  }
}
```

`index.html` holds what is fixed (the title, a heading) and an element for the
module to draw in, and loads the module:

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Visitors' book</title>
  <link rel="stylesheet" href="style.css">
  <main>
    <h1 data-copy="title"></h1>
    <p data-copy="intro"></p>
    <div id="app"></div>
  </main>
  <script type="module" src="main.ts"></script>
</html>
```

`main.ts` imports `./api/client.js` at runtime, by its address beside the page,
because it is served by the store rather than compiled into the module:

```ts ignore
let { apply, drafts, subscribe } = await import(
  new URL('api/client.js', document.baseURI).href
)
```

## Stylesheets for server-rendered pages

Declare `"@yaks/ui": "platform"` in `package.json` and link the kit stylesheets
from `__packages/@yaks/ui/` under the app's mount. The compiler supplies those
files for apps with a Worker. Put app stylesheets in the release and link them
from the same `<head>`. For example, a page at the app's root with a custom
theme can link the following files.

```html
<link rel="stylesheet" href="./theme.css">
<link rel="stylesheet" href="./__packages/@yaks/ui/derived.css">
<link rel="stylesheet" href="./__packages/@yaks/ui/base.css">
<link rel="stylesheet" href="./__packages/@yaks/ui/Button.css">
<link rel="stylesheet" href="./style.css">
```

Link the stylesheets for the parts the page uses. For a page on a nested route,
build the stylesheet URLs from the app's mount. The platform rewrites these
links to immutable release asset URLs. If a private app's Worker serves the page
to visitors, pass the stylesheet requests through to `env.FILES` along with the
page's other visitor-facing assets.

## Colours and type

Every part paints with the same CSS custom properties. A **theme** sets them
all; `wear({ kits, theme: themes.linen })` from `@yaks/ui/wear` links the
theme's and the kit's stylesheets ahead of the page's own and resolves once they
have loaded, so render after it. Then the app's `style.css` sets the ones its
design plan chose (<https://yaks.app/docs/design.md>, Plan before code), and
every part wears them:

| Property                      | What it colours or sets                       |
| ----------------------------- | --------------------------------------------- |
| `--bg`, `--surface`, `--card` | the page, a raised area, a card               |
| `--border`, `--border2`       | faint lines, drawn lines                      |
| `--text`, `--muted`, `--dim`  | what a thing says, what describes it, a blank |
| `--accent`                    | the main action and what is selected          |
| `--negative`, `--positive`    | a failure, a success                          |
| `--font`, `--mono`            | the typeface, and the one for codes           |
| `--size`, `--small`           | body text, the line under it                  |
| `--gap`, `--radius`           | spacing, corner rounding                      |

The kit's sizes are small for a phone (14 px body text), so set `--size` to 16
px or more. Write a dark scheme the way the parts read it: each colour as
`light-dark(light, dark)`.

## Words

The words a script draws come from `copy.json` too
(<https://yaks.app/docs/copy.md>). Read it once beside the stylesheets, and give
each element that shows a snippet its `data-copy` key, so the person's pencil
can edit it.

## The visitors' book

A form that keeps what a visitor types until the book has it, and the notes left
so far, newest first. It runs at <https://yourname.yaks.app/signbook/>. Its
`vocab.json` declares `signature` with `name` and `message`, and its `copy.json`
holds the words the module names.

```ts ignore
import { h, render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Button, Card, Empty, Form, Notice, Rows, Stamp } from '@yaks/ui'
import { relative } from '@yaks/ui/relative'
import { kits, themes } from '@yaks/ui/ui'
import { wear } from '@yaks/ui/wear'
import {
  type Bundle,
  Fields,
  type FieldSpec,
  putValue,
  Submit,
  type Values,
} from '@yaks/ux'

type Signature = {
  entity: { eid: string }
  signature: { name: string; message: string }
  created?: { at: string }
}

let { apply, drafts, subscribe } = await import(
  new URL('api/client.js', document.baseURI).href
)
let [copy] = await Promise.all([
  fetch('copy.json').then((r) => r.json()),
  wear({ kits, theme: themes.linen }),
])
let desk = drafts()

/** A snippet of copy.json, marked so the page's pencil can edit it. */
let say = (key: string) => ({
  'data-copy': key,
  children: key.split('.').reduce((o, k) => o?.[k], copy) ?? '',
})

let fields: FieldSpec[] = [
  { path: ['name'], label: copy.form.name, kind: 'text', required: true },
  {
    path: ['message'],
    label: copy.form.message,
    kind: 'lines',
    required: true,
  },
]
let filled = (v: Values) =>
  fields.every((f) => String(v[f.path[0]] ?? '').trim())

/** The form: Submit keeps its values in the visitor's draft at `place`, and
 * spends that draft only once the note is stored. */
let Sign = () => {
  let [e, setE] = useState<Bundle>()
  return h(Submit<object>, {
    at: 'sign',
    place: 'signbook:sign',
    drafts: desk,
    e,
    onChange: setE,
    read: () => Promise.resolve({}),
    send: async (_at, v) => {
      try {
        await apply([{
          entity: { eid: '$signature' },
          signature: {
            name: String(v.name).trim(),
            message: String(v.message),
          },
        }])
      } catch (err) {
        return (err as Error).message
      }
    },
    render: ({ state, change, send }) => {
      let values = state.values ?? {}
      let sign = async (ev: Event) => {
        ev.preventDefault()
        if (state.sending) return
        if (!filled(values)) return change({ tried: true, sent: false })
        change({ sending: true, said: undefined, sent: false })
        let said = await send('sign', values)
        change(
          said == null
            ? { sending: false, sent: true, tried: false }
            : { sending: false, said },
        )
      }
      return h(
        Form,
        { onSubmit: sign, noValidate: true },
        h(Fields, {
          at: 'sign',
          fields,
          values,
          disabled: state.sending,
          onChange: (path, value) =>
            change({ values: putValue(values, path, value), sent: false }),
        }),
        state.tried && !filled(values)
          ? h(Notice, { mod: 'negative', ...say('form.owed') })
          : null,
        state.said
          ? h(Notice, { mod: 'negative', role: 'alert' }, state.said)
          : null,
        state.sent ? h(Notice, { role: 'status', ...say('form.sent') }) : null,
        h(
          Form.Actions,
          {},
          h(
            Button,
            { type: 'submit', mod: 'go', disabled: state.sending },
            h('span', say(state.sending ? 'form.sending' : 'form.send')),
          ),
        ),
      )
    },
  })
}

/** Every signature, newest first. */
let Book = () => {
  let [signed, setSigned] = useState<Signature[]>()
  useEffect(() => {
    return subscribe('.signature&?created', (rows: Signature[]) =>
      setSigned(
        [...rows].sort((a, b) =>
          (b.created?.at ?? '').localeCompare(a.created?.at ?? '')
        ),
      ))
  }, [])
  if (!signed) return null
  if (!signed.length) {
    return h(
      Empty,
      {},
      h(Empty.Title, say('empty.title')),
      h('p', say('empty.body')),
    )
  }
  return h(
    Rows,
    {},
    signed.map((n) =>
      h(
        Rows.Item,
        { key: n.entity.eid },
        h(
          Rows.Main,
          {},
          h(Rows.Name, {}, n.signature.name),
          h(Rows.Meta, {}, n.signature.message),
        ),
        n.created ? h(Stamp, {}, relative(n.created.at, Date.now())) : null,
      )
    ),
  )
}

render(
  h('div', {}, h(Card, {}, h(Sign, {})), h(Book, {})),
  document.getElementById('app')!,
)
```

How the form keeps a draft:

- `place` names the draft. The same person at the same place finds the same
  values on every device; choose a place that stays the same across visits, such
  as `log:new` for a new entry or `log:<eid>` for editing one.
- `Submit` draws whatever is in the draft, including a draft restored once the
  store knows who is typing and one typed in another tab.
- `send` answers nothing when the store saved the entry, and the refusal's words
  when it did not. `Submit` empties the draft only after a save, and only if
  nothing more was typed while it was saving.
- The `render` callback owns the form's states: `tried` for a press with fields
  missing, `sending` while it saves, `sent` once it saved, and `said` for why it
  did not.

## Parts for a list

A list of entries is `Rows`, one `Rows.Item` each: `Rows.Main` holding the
entry's `Rows.Name` over its `Rows.Meta`, and `Rows.Actions` for buttons that
act on it. A list to pick from holds `Tile`s, each with `Tile.Title` and
`Tile.Sub`, the picked one with `mod: 'on'`. An empty list is `Empty` with an
`Empty.Title` and a line saying how to start. Progress toward a number is
`Meter`; a series over days is `sparkline` or `columns` from `@yaks/ui/chart`; a
table whose columns sort is `Sort` from `@yaks/ux` over `Table`. Every part is
listed with its pieces and variants in the @yaks/ui README at
<https://jsr.io/@yaks/ui>.

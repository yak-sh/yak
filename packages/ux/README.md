# @yaks/ux

Controlled Preact components for editing properties, stacking panes and
completing input. Component state lives in a page graph; drafts and emitted
bundles belong to the caller.

A **UX component** supplies behavior between [@yaks/ui](../ui/README.md)'s
presentation and an application's data. It takes a
[bundle](../graph/README.md#data-model) and emits a bundle through `onChange`,
or through its host's `write` when `onChange` is absent. Its state is a
[component](../graph/README.md#data-model) in the page's
[graph](../graph/README.md#data-model), rather than private component state.

A **host** (`Host`) supplies the vocabulary, page graph, drafts, writes and
presentation callbacks to UX components. `Ux` passes it down a Preact tree. An
**owner** is the consumer named by `Ux`'s `at`; nested names join with `/`.
Owners distinguish two editors of the same property while their
[draft](../draft/README.md) is shared by the property's place (`place`).

A **face** is a property's presentation at rest. A **control** changes that
property while its `Edit` state is open. `Edit` selects both from the property's
[vocabulary](../vocab/README.md#vocabulary) declaration.

## Use

The page graph holds UX state separately from the vocabulary of the values being
edited. This example supplies host-owned drafts with signals; a persistent host
can use [@yaks/draft](../draft/README.md).

```ts
import { h, render } from 'preact'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'
import { Edit, emit, type Host, useEdit, useHost, useOwner, Ux } from '@yaks/ux'
import { docs } from '@yaks/ux/vocab'

let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
let typed = signal<Record<string, string>>({})
let e = { entity: { eid: 'book' }, book: { title: 'Draft' } }
let sent: unknown[] = []
let host: Host = {
  vocab: loadVocab({
    $defs: {
      book: { component: true, properties: { title: { type: 'string' } } },
    },
  }),
  front,
  drafts: {
    text: (place) => typed.value[place] ?? '',
    type: (place, text) => typed.value = { ...typed.value, [place]: text },
    spend: (place) => typed.value = { ...typed.value, [place]: '' },
  },
  write: (b) => sent.push(b),
  name: (eid) => eid,
  id: (b) => b.entity.eid,
  kind: () => 'book',
  when: (at) => at,
  find: async () => [],
}
let { document } = parseHTML('<html><body><main></main></body></html>')
let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', {
  value: document,
  configurable: true,
})
let root = document.querySelector('main')!
let editing: ReturnType<typeof useEdit> | undefined
let Probe = () => {
  equal(useHost(), host)
  equal(useOwner(), 'catalog')
  editing = useEdit('book', 'book', 'title')
  return h(Edit, { e, comp: 'book', prop: 'title', editable: true })
}
try {
  render(h(Ux, { host, at: 'catalog' }, h(Probe, {})), root)
  equal(root.textContent, 'Draft')
  editing!.begin()
  equal(editing!.now()?.open, true)
  editing!.type('Published')
  equal(host.drafts.text(editing!.place), 'Published')
  editing!.spend()
  editing!.end()
  equal(editing!.now(), undefined)
  emit(host, undefined, e, 'book', 'title', 'Published')
  equal(sent, [{ entity: { eid: 'book' }, book: { title: 'Published' } }])
} finally {
  render(null, root)
  front.close()
  if (prior) Object.defineProperty(globalThis, 'document', prior)
  else Reflect.deleteProperty(globalThis, 'document')
}
```

## Exports

| Entry point           | Provides                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/ux`            | `Edit`, `Text`, `Stack`; `Ux`, `useHost`, `useOwner`; `useEdit`; state, emission, formatting and picker helpers; `defineKit`, `kitDocs`; `completion`; their types |
| `@yaks/ux/views`      | `editorViews`, `views`: editor registrations and their registry                                                                                                    |
| `@yaks/ux/vocab`      | `uxDoc`, `docs`, `description`: the UX vocabulary documents and package summary                                                                                    |
| `@yaks/ux/ui`         | `kit`, `ux`: the base UX kit and `{ base: kit }`                                                                                                                   |
| `@yaks/ux/completion` | `completion`; `typed`, `placed`, `moved`, `taken`, `dismissed`, `act`, `CAP`; controller, input and transition types                                               |

## Kits from outside

A **UX kit** (`Kit`, distinct from a
[UI kit](../ui/README.md#parts-and-rendering)) carries controlled components,
descriptions and [specimens](../ui/README.md#parts-and-rendering). It also
carries the vocabulary document declaring their state. `defineKit` checks this
boundary and returns it with its component types intact. The package owns those
state components: each state component is CamelCase, explicitly `sync: none`,
and has a page lifetime (`durable: connection`, or a duration; `0s` for an
event), never `forever`. A UX kit brings no rules, effects or tools. Values it
edits and persistent typing drafts belong to its caller, not to this vocabulary.

```ts
import { h } from 'preact'
import { defineKit, kitDocs } from '@yaks/ux'
import { equal } from '@yaks/testing'
import { type Bundle } from '@yaks/graph'
import { ux as base } from '@yaks/ux/ui'

// An outside package's controlled component; its owner supplies the bundle and
// writes the emitted bundle into the page graph.
let Toggle = ({ e, onChange }: { e: Bundle; onChange: (b: Bundle) => void }) =>
  h('button', {
    onClick: () =>
      onChange({
        entity: e.entity,
        Toggle: { open: !(e.Toggle as { open?: boolean } | undefined)?.open },
      }),
  }, (e.Toggle as { open?: boolean } | undefined)?.open ? 'Close' : 'Open')

let toggle = defineKit({
  description: 'A controlled toggle',
  vocab: {
    $defs: {
      Toggle: {
        component: true,
        sync: 'none',
        durable: 'connection',
        properties: { open: { type: 'boolean' } },
      },
    },
  },
  components: {
    Toggle: {
      Component: Toggle,
      description: 'Open or close the consumer-named entity',
      state: ['Toggle'],
      specimens: () => [[
        'Closed',
        h(
          'div',
          {},
          h(Toggle, {
            e: { entity: { eid: 'guide-toggle' }, Toggle: { open: false } },
            onChange: () => {},
          }),
        ),
      ]],
    },
  },
})

let kits = { ...base, toggle }
equal(kitDocs(kits), [base.base.vocab, toggle.vocab])
equal(toggle.components.Toggle.specimens()[0][0], 'Closed')
let sent: Bundle[] = []
let button = Toggle({
  e: { entity: { eid: 'my-toggle' }, Toggle: { open: false } },
  onChange: (b) => sent.push(b),
})
button.props.onClick()
equal(sent, [{ entity: { eid: 'my-toggle' }, Toggle: { open: true } }])
```

`kitDocs(kits)` supplies the checked vocabulary documents, deduplicated by
identity. A page loads them beside its other page words when making its client;
discovering a facet does not load state into a graph. A shared client with a
server still keeps these words in page memory, not on the wire or in its vault.
On that client, use a local watch (`front.watch('.Toggle', {remote: false})`)
for page-only state rather than requesting a server subscription.

A package's `./ui` facet exports `ux = {toggle}` beside any `kits`, `themes` and
`skins` it contributes. `@yaks/ux/ui` exports `kit` and `ux = {base: kit}`:
`Edit`, `Stack` and `Text`, with labelled Preact specimens. `Text` shares `Edit`
state. **Refused** is the transient event component emitted when input cannot be
read; its `said` property is the reason. The guide reads
`components[name].description` and `specimens()` without importing UX or
invoking its component references. Guide identities must include the kind and
kit name: UI `base/Edit` and UX `base/Edit` are separate entries even though
they have the same component name. The UI composition supplies the look; UX kits
supply behavior and page words, not CSS or terminal sheets.

## Edit

`Edit` changes a property's value where it stands. Its face and its control are
selected by the property's type through a
[@yaks/render registry](../render/README.md) (`views`, the `./views` facet) and
drawn with @yaks/ui's `Prop` and `Edit` parts.

| a property's type                     | its control                                                  | its face                                                 |
| ------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| text, a body, number, url, time, JSON | typed over in place, read as its type; a body on many lines  | the text; a priority `P2`; a url a link; a time in words |
| enum, bool                            | a popout row of choices, the held one marked; a flag toggles | the value                                                |
| ref                                   | a popout search of the graph over the entities it may name   | what the entity is called                                |
| text with a `well`                    | a popout of the values seen so far, what is typed one too    | the text                                                 |
| query                                 | the host's query field (@yaks/filter), or text without one   | the line                                                 |

A 'none' choice in a reference or well control clears the value. Typed over in
place, the value keeps its element, font and box, so nothing on the page moves;
Enter (a body: leaving it) emits what was typed, and Escape puts the value back.
A [body](../blob/README.md#mark-the-property) (`store: 'blob'`) the bundle does
not carry is one the page has not loaded, and is not offered for typing over.

```ts
import { h } from 'preact'
import { Edit, editorViews, formatProp, reading } from '@yaks/ux'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'published'] },
      },
    },
  },
})
let e = { entity: { eid: 'book' }, book: { title: 'Draft', price: 3 } }
equal(reading({ vocab }, e, 'book', 'price', '12'), {
  entity: { eid: 'book' },
  book: { price: 12 },
})
equal(formatProp(vocab, 'book', 'price', 12), '12')
let text = h(Edit.Text, { e, comp: 'book', prop: 'title', inline: true })
let control = h(Edit.Control, {
  e,
  comp: 'book',
  prop: 'status',
  anchor: { current: null },
})
equal(text.type, Edit.Text)
equal(control.type, Edit.Control)
equal(editorViews().every((entry) => entry.view == 'Edit'), true)
```

| export                             | what it is                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Edit`                             | the value; editable, a press opens its control. `show` paints a custom face, `handle` gives a link a handle |
| `Edit.Text`                        | the value typed over in place, opened by a double-click or by its owner (`multi`, `inline`, `readOnly`)     |
| `Edit.Control`                     | the control alone, anchored where its caller says, drawn while its state is open                            |
| `useEdit`, `Editing`               | an `Edit`'s state and its value's draft, read live, and `begin`, `end`, `type`, `spend`, `search`           |
| `at`, `place`, `put`, `changed`    | the names and bundles, pure; `refused`, `source`, `valueOf` too                                             |
| `Ux`, `useHost`, `Host`            | what a page hands down                                                                                      |
| `views`, `editorViews`             | the controls as registrations; `TimeVal`, `UrlVal` are faces                                                |
| `pickLine`, `useHits`, `label`     | a picker's candidates, asked of the graph                                                                   |
| `canEdit`, `formatProp`, `reading` | what a value is, pure                                                                                       |
| `Stack`, `StackProps`              | panes stacked as a person goes, a strip for each under the top one                                          |
| `stackAt`, `panesOf`, `stacked`    | a stack's eid and bundles, pure; `cut`, `LIMIT` too                                                         |

## Stack

A **pane** is content named by a key its owner draws. A **strip** represents a
pane under the top one; pressing it returns to that pane and closes those above
it. `Stack` holds at most six panes (`LIMIT`), bottom first. Going beyond the
limit removes the oldest pane. The look is [@yaks/ui](../ui/README.md)'s
`Stack`: a strip is a vertical spine in a browser and a framed column in a
terminal.

The controlling bundle carries `Stack{panes, scroll}`. A strip press emits the
bundle returned by `cut` through `onChange`. The owner writes `stacked` when
navigation opens a pane, supplies `Pane` and `Strip` to draw its contents, and
decides where emitted bundles go. A browser host can also put pane keys in the
address so back, forward and shared links restore navigation.

```ts
import { h } from 'preact'
import {
  cut,
  panesOf,
  scrolledPane,
  scrollOf,
  Stack,
  stackAt,
  stacked,
} from '@yaks/ux'
import { equal } from '@yaks/testing'

let e = { entity: { eid: stackAt('catalog') }, Stack: { panes: ['list'] } }
let next = stacked(e, 'book')
equal(panesOf(next), ['list', 'book'])
next = scrolledPane(next, 'book', 120)
equal(scrollOf(next, 'book'), 120)
equal(panesOf(cut(next, 0)), ['list'])
equal(panesOf(stacked(next, 'chapter', 2)), ['book', 'chapter'])
let sent: unknown[] = []
let tree = h(Stack, {
  e: next,
  onChange: (b) => sent.push(b),
  Pane: ({ pane, top }) => h('p', {}, `${pane}: ${top}`),
  Strip: ({ pane }) => h('span', {}, pane),
})
tree.props.onChange(cut(next, 0))
equal(sent, [cut(next, 0)])
```

## State and events

| component    | on                                | what it holds                                          |
| ------------ | --------------------------------- | ------------------------------------------------------ |
| `Edit`       | `at(owner, eid, comp, prop)`      | `open` while it is changed here, `query` in its picker |
| `Stack`      | `stackAt(owner)`                  | `panes`, bottom first, and `scroll` per pane           |
| `Completion` | field id                          | `caret`, `from`, `to`, `cands`, `pick`                 |
| `Refused`    | the entity whose value it changes | an event: `said`, why what was typed could not be read |

Each state component is `sync: none`: nothing leaves the page. `Edit`, `Stack`
and `Completion` are `durable: connection`, gone with the page and kept across
every remount before that; closing an `Edit` removes it. What is typed over a
value is not its state but the person's draft, in the value's own place
(`place(eid, comp, prop)`), kept by the host's `drafts`: every view of the
value, and every interface the host syncs drafts to, types on from it, and a
value whose draft says something else shows it, open, wherever it is drawn.
Leaving a value typed over emits it and spends the draft, Escape puts the value
back and spends it, and being taken off the page is neither: the draft waits for
the remount. `Refused` is `durable: "0s"`; see
[component lifetimes](../vocab/README.md#state-lifetimes).

The state helpers can also be used without rendering a component.

```ts
import {
  at,
  changed,
  label,
  pickLine,
  place,
  put,
  refused,
  source,
  valueOf,
} from '@yaks/ux'
import { equal } from '@yaks/testing'

let e = { entity: { eid: 'book' }, book: { title: 'Draft' } }
equal(
  at('list', 'book', 'book', 'title') == at('detail', 'book', 'book', 'title'),
  false,
)
equal(place('book', 'book', 'title'), 'edit:book:book.title')
equal(put('editing', { open: true }), [
  { entity: { eid: 'editing' }, Edit: { open: true } },
])
equal(
  valueOf(changed(e, 'book', 'title', 'Published'), 'book', 'title'),
  'Published',
)
equal(source({ pages: 12 }), '{"pages":12}')
equal(refused(e, 'Expected a number'), {
  entity: { eid: 'book' },
  Refused: { said: 'Expected a number' },
})
equal(pickLine('Ada', 'person'), 'Ada .person *')
equal(
  label({ id: (b) => b.entity.eid, kind: () => 'book' }, {
    entity: { eid: 'book' },
    doc: { title: 'Dune' },
  }),
  'book — Dune',
)
```

`pickLine` builds a [query](../query/README.md#query-model) for a reference
picker. `useHits` asks the host's `find` after 150 ms without further typing,
aborts the previous request, and clears an empty line without a request. `Find`
implementations should honor the abort signal. `label` uses the returned
bundle's `rank.title`, then `doc.title`, then the host's `kind`.

## Completion

`@yaks/ux/completion` manages [completion](../query/README.md#completion) state,
candidate selection, keyboard actions and presentation for domain adapters such
as [@yaks/filter](../filter/README.md). The domain still decides which
replacements to offer, and `@yaks/ui`'s `Field` and `Choices` present them.

`completion(front, opts)` returns a controller for fields in one front-end
graph. Supply `opts.complete(text, caret)`, returning a `Result` or a promise of
one, and host-owned `drafts{text, type}`. `Result` uses the
[completion shape](../query/README.md#completion), `{from, to, cands, whole}`.
Async results are applied only while the field still has the matching text and
caret.

The default state component is `Completion{caret, from, to, cands, pick}`; text
stays in the host's draft. `opts.component` can name another component:
`@yaks/filter` uses `filter` for its state and supplies query completion.
`opts.Float` hosts the candidate list; without it, the list paints in the flow.

The controller provides `Field` for a managed input, or `bind(id, element)` and
`List` for an existing input. `bind` returns listener cleanup; `dispose()`
releases the controller's graph subscription. Its actions are `type`, `set`,
`move`, `accept`, `dismiss` and `press`, with reactive `row` and `text` reads.
Tab accepts, arrows move the selection, Escape dismisses, and Enter accepts only
when a candidate is selected; otherwise the key belongs to the host. The pure
transitions (`typed`, `placed`, `moved`, `taken`, `dismissed`, `act`) and their
types are exported from the same entry point.

```ts
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { loadVocab } from '@yaks/vocab'
import { docs } from '@yaks/ux/vocab'
import {
  act,
  completion,
  dismissed,
  moved,
  placed,
  taken,
  typed,
} from '@yaks/ux/completion'
import { equal } from '@yaks/testing'

let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
let draftFront = client(loadVocab(draftDoc), [drafts()], {
  vault: false,
  wireVault: false,
})
let kept = desk(draftFront, { by: () => 'reader' })
let offers = (text: string, caret: number) => ({
  from: 0,
  to: caret,
  cands: text == 'pe'
    ? [
      { text: 'pear', kind: 'fruit' },
      { text: 'peach', kind: 'fruit' },
    ]
    : [],
  whole: false,
})
let c = completion(front, { drafts: kept, complete: offers })
try {
  c.type('field', 'pe')
  equal(c.row('field')?.pick, 0)
  equal(c.press('field', 'ArrowDown'), true)
  equal(c.press('field', 'Enter'), true)
  equal(c.text('field'), 'peach')
  equal(kept.text('field'), 'peach')
  c.set('field', 'pe')
  equal(c.row('field')?.cands, [])
  c.type('field', 'pe')
  c.dismiss('field')
  equal(c.press('field', 'Tab'), false)

  let row = typed('pe', 2, offers('pe', 2))
  equal(taken({ ...row, ...moved(row, 1) }), { text: 'peach', caret: 5 })
  equal(act({ ...row, ...dismissed }, 'Tab'), undefined)
  equal(placed('pear').caret, 4)
} finally {
  c.dispose()
  front.close()
  draftFront.close()
}
```

`Field` supplies a managed input; `bind` attaches the same behavior to an
existing input and `List` draws its candidates. Both need a rendered Preact
tree.

```ts
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { loadVocab } from '@yaks/vocab'
import { docs } from '@yaks/ux/vocab'
import { completion } from '@yaks/ux/completion'
import { equal } from '@yaks/testing'

let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
let draftFront = client(loadVocab(draftDoc), [drafts()], {
  vault: false,
  wireVault: false,
})
let c = completion(front, {
  drafts: desk(draftFront, { by: () => 'reader' }),
  complete: (_text, caret) => ({
    from: 0,
    to: caret,
    whole: false,
    cands: [{ text: 'pear', kind: 'fruit' }],
  }),
})
let { document } = parseHTML('<html><body><main></main><input></body></html>')
let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', {
  value: document,
  configurable: true,
})
let root = document.querySelector('main')!
let input = document.querySelector('input')!
// Linkedom has no selection API; browsers provide this method.
input.setSelectionRange = (start) =>
  Object.defineProperty(input, 'selectionStart', {
    value: start,
    configurable: true,
  })
let off = () => {}
try {
  render(h(c.Field, { id: 'managed', initial: 'pe' }), root)
  equal(root.querySelector('input')?.value, 'pe')
  c.type('separate', 'pe')
  off = c.bind('separate', input)
  render(h(c.List, { id: 'separate', anchor: { current: input } }), root)
  equal(input.value, 'pe')
  equal(root.textContent?.includes('pear'), true)
  c.accept('separate')
  equal(input.value, 'pear')
} finally {
  off()
  render(null, root)
  c.dispose()
  front.close()
  draftFront.close()
  if (prior) Object.defineProperty(globalThis, 'document', prior)
  else Reflect.deleteProperty(globalThis, 'document')
}
```

## The host

`h(Ux, { host }, tree)` hands the host to every UX component under it, so one
page may hold several. An inner `h(Ux, { at }, …)` names a consumer within the
one above it, keeping the host: web names each card by its eid and each view
drawn on it by the view's name, so a title in a card's bar and in its body, or
on two cards, keeps a state of its own. The host supplies:

- `vocab`: what a property is, and whether a client may write it.
- `front`: the page's own graph, where each state lives (a @yaks/client over
  this package's `./vocab`).
- `drafts`: where what is typed waits until it is sent or put back, by place
  (`text`, `type`, `spend`); @yaks/draft's `desk` keeps a person's drafts in the
  graph, synced to every interface they use.
- `write(b)`: where an emitted bundle goes when its caller names nowhere else.
- `name`, `id`, `kind`, `when`: what an entity is called, its human id and kind,
  and a moment in words.
- `find(line, limit)`: a server search, the entities a query line answers.

and, where the page has them: `editing` (its input language, @yaks/render
`EditOptions`), `values` (a well's values), `fields` (its query fields),
`markup` (inline markdown), `wears` (what a choice wears beside its word, a
status's dot), and `Float`, the platform's popover (@yaks/ui's, in a browser);
without it a popout paints in the flow, as a terminal wants.

## Limits

UX components do not fetch bodies, keep persistent drafts or decide navigation
URLs. The host supplies those policies. Styling belongs to
[@yaks/ui](../ui/README.md); vocabulary declarations belong to
[@yaks/vocab](../vocab/README.md); query syntax and query completion belong to
[@yaks/query](../query/README.md).

## Files

| file                  | owns                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `kit.ts`              | external kit metadata, boundary validation and vocabulary documents |
| `ui.ts`               | the base kit and its browser-safe `./ui` facet and specimens        |
| `vocab.json`          | the `Edit`, `Stack`, `Completion` and `Refused` components          |
| `state.ts`            | the bundles: an `Edit`'s eid, its patches, what it emits            |
| `live.ts`             | `useEdit`: an `Edit`'s state and its value's draft, read live       |
| `emit.ts`             | typed or picked input, read as its type, sent as a bundle           |
| `host.ts`             | `Host`, `Ux`                                                        |
| `Edit.ts`             | `Edit`, its controls and faces, `views`                             |
| `Text.ts`             | `Edit.Text`                                                         |
| `Stack.ts`            | `Stack`, its eid and bundles                                        |
| `hits.ts`             | a picker's line and its debounced search                            |
| `read.ts`             | what a property is, off the vocabulary                              |
| `completion.ts`       | shared completion controller, field, list and input binding         |
| `completion-state.ts` | pure completion transitions and candidate types                     |

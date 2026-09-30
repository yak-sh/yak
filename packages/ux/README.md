# @yaks/ux

UX components: what sits between a UI component ([@yaks/ui](../ui/README.md): a
look, no behavior) and a domain component (meaning: queries, server data). A UX
component prescribes behavior and keeps nothing in memory of its own:

- It is controlled by a bundle and emits a bundle of the same shape, the way
  `<input value onChange>` is. `Edit` handed
  `{entity: {eid}, doc: {title: 'Draft'}}` emits
  `{entity: {eid}, doc: {title: 'Ship it'}}`. Presses and typing are how it gets
  there, never its interface.
- When it has something to say that is not a new value, it emits an event
  bundle, the exception: `Refused`, input that could not be read.
- Its own state is one component named after it, in CamelCase, declared in
  `vocab.json`, on an entity of its own in the page's graph. The eid is derived
  from its owner and the value it changes (`at`), so a remount finds its state
  again, and whoever owns it reads and opens it there (`useEdit`).
- Where a value lives is its caller's choice: the bundle it emits goes to the
  caller's `onChange`, or else to the host's `write`, and it never knows which
  graph that is.

## Edit

A property's value, changed where it stands. Its face and its control are
selected by the property's type through a @yaks/render registry (`views`, the
`./views` facet) and drawn with @yaks/ui's `Prop` and `Edit` parts.

| a property's type                     | its control                                                  | its face                                                 |
| ------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| text, a body, number, url, time, JSON | typed over in place, read as its type; a body on many lines  | the text; a priority `P2`; a url a link; a time in words |
| enum, bool                            | a popout row of choices, the held one marked; a flag toggles | the value                                                |
| ref                                   | a popout search of the graph over the entities it may name   | what the entity is called                                |
| text with a `well`                    | a popout of the values seen so far, what is typed one too    | the text                                                 |
| query                                 | the host's query field (@yaks/filter), or text without one   | the line                                                 |

A 'none' row in a popout clears the value. Typed over in place, the value keeps
its element, font and box, so nothing on the page moves; Enter (a body: leaving
it) emits what was typed, and Escape puts the value back. A body
(`store:
'blob'`) the bundle does not carry is one the page has not loaded, and
is not offered for typing over.

```ts ignore
import { Edit, Ux } from '@yaks/ux'

h(Ux, { host }, app) // once, at the root of the tree
h(Edit, { e, comp: 'filed', prop: 'priority', editable: true })
h(Edit.Text, { e, comp: 'doc', prop: 'title', inline: true }) // double-click
h(Edit.Control, { e, comp: 'task', prop: 'status', anchor, onChange })
```

| export                             | what it is                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Edit`                             | the value; editable, a press opens its control. `show` paints a custom face, `handle` gives a link a handle |
| `Edit.Text`                        | the value typed over in place, opened by a double-click or by its owner (`multi`, `inline`, `readOnly`)     |
| `Edit.Control`                     | the control alone, anchored where its caller says, drawn while its state is open                            |
| `useEdit`, `Editing`               | an `Edit`'s state, read live, and `begin`, `end`, `type`, `search`                                          |
| `at`, `put`, `changed`, `refused`  | the bundles, pure                                                                                           |
| `Ux`, `useHost`, `Host`            | what a page hands down                                                                                      |
| `views`, `editorViews`             | the controls as registrations; `TimeVal`, `UrlVal` are faces                                                |
| `pickLine`, `useHits`, `label`     | a picker's candidates, asked of the graph                                                                   |
| `canEdit`, `formatProp`, `reading` | what a value is, pure                                                                                       |

## State and events

| component | on                                | what it holds                                                           |
| --------- | --------------------------------- | ----------------------------------------------------------------------- |
| `Edit`    | `at(owner, eid, comp, prop)`      | `open` while it is changed, `text` typed over it, `query` in its picker |
| `Refused` | the entity whose value it changes | an event: `said`, why what was typed could not be read                  |

Both are `sync: none`: nothing leaves the page. `Edit` is `durable: connection`,
gone with the page and kept across every remount before that; closing it removes
it. Leaving a value typed over emits it, and being taken off the page is not
leaving it: the draft waits in the graph for the remount. `Refused` is
`durable: "0s"`, which is how a vocabulary marks an event: a graph applies it
and carries it back in the applied change, and never stores it (@yaks/vocab).

## The host

`h(Ux, { host }, tree)` hands a host to every UX component under it, so one page
may hold several. An inner `h(Ux, { at }, …)` names a consumer within the one
above it, keeping the host: web names each card by its eid and each view drawn
on it by the view's name, so a title in a card's bar and in its body, or on two
cards, keeps a state of its own. The host supplies:

- `vocab`: what a property is, and whether a client may write it.
- `front`: the page's own graph, where each state lives (a @yaks/client over
  this package's `./vocab`).
- `write(b)`: where an emitted bundle goes when its caller names nowhere else.
- `name`, `id`, `kind`, `when`: what an entity is called, its human id and kind,
  and a moment in words.
- `find(line, limit)`: a server search, the entities a query line answers.

and, where the page has them: `editing` (its input language, @yaks/render
`EditOptions`), `values` (a well's values), `fields` (its query fields),
`markup` (inline markdown), `wears` (what a choice wears beside its word, a
status's dot), and `Float`, the platform's popover (@yaks/ui's, in a browser);
without it a popout paints in the flow, as a terminal wants.

## Files

| file         | owns                                                          |
| ------------ | ------------------------------------------------------------- |
| `vocab.json` | the `Edit` and `Refused` components                           |
| `state.ts`   | the bundles: an `Edit`'s eid, its patches, what it emits      |
| `live.ts`    | `useEdit`: an `Edit`'s state, read live from the page's graph |
| `emit.ts`    | typed or picked input, read as its type, sent as a bundle     |
| `host.ts`    | `Host`, `Ux`                                                  |
| `Edit.ts`    | `Edit`, its controls and faces, `views`                       |
| `Text.ts`    | `Edit.Text`                                                   |
| `hits.ts`    | a picker's line and its debounced search                      |
| `read.ts`    | what a property is, off the vocabulary                        |

# @yaks/filter

The query field: completion wherever a query is typed, the same in a browser and
in a terminal. It is a domain component in the sense of
https://yak.sh/composable-ui.md: built only of [@yaks/ui](../ui/README.md)'s
`Field` and `Choices`, its state an entity in the page's own graph, its actions
patches to that entity.

## State

Each field is one entity in a front-end graph (a local @yaks/client over RAM),
named by its host (`search`, `filter:<board>`), wearing the `filter` component
this package declares (`vocab.json`, `sync: none`):

| property | what it is                                                  |
| -------- | ----------------------------------------------------------- |
| `text`   | what is typed                                               |
| `caret`  | where the caret stands                                      |
| `from`   | where the word being completed starts                       |
| `to`     | where it ends                                               |
| `cands`  | what can replace it (@yaks/query `complete`), at most eight |
| `pick`   | which of those is picked                                    |

The list is open while `cands` has any. Anything on the page reads what is typed
in a field by reading its row: a board narrows its rows by its filter field, a
palette searches for its search field's text.

## Use

```ts ignore
import { client } from '@yaks/client'
import { filters } from '@yaks/filter'
import { docs } from '@yaks/filter/vocab'
import { loadVocab } from '@yaks/vocab'

let front = client(loadVocab(docs), [], { vault: false })
let { Filter, text } = filters(front, { vocab, source, Float })

// <Filter id='search' placeholder='search…' onKey={key} />
text('search') // what is typed there, read reactively
```

The host supplies what the field cannot know: `vocab`, the vocabulary its
queries speak; `source`, what only a graph can answer, the entity ids a
reference could name and the values a property holds (@yaks/query `Source`,
answering at once or with a promise); and `Float`, where the list floats beside
its field. Without `Float` the list paints in the flow, under the field.

## Actions

`type(id, text, caret)` is what the person typed, and completes at the caret.
`set(id, text)` is text the host put there, offering nothing. `move(id, d)`,
`accept(id, i?)` and `dismiss(id)` walk, take and close the list; taking a word
completes on from it, so `.status` rolls on to `.status=` and then its values.
`press(id, key)` is a key, named as a browser names it, and says whether the
list took it. Each is a patch to the field's row; `state.ts` is what each makes
of a row, pure.

## Keys

While the list is open, Tab or Enter takes the pick, ↑ and ↓ move it, and Escape
closes the list. Every other key, and any key with a modifier, is the host's:
`Filter` hands it to `onKey`. In a browser the element does the editing and
`Filter` wires it; a terminal calls `type` and `press` from its own key loop and
passes `active`, so the field paints its caret (@yaks/tui paints a
`data-caret`).

## Files

| file         | owns                                                    |
| ------------ | ------------------------------------------------------- |
| `vocab.json` | the `filter` component                                  |
| `state.ts`   | what each action makes of a row, and the key table      |
| `filters.ts` | `filters()`: the actions bound to a graph, and `Filter` |

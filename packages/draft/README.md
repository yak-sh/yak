# @yaks/draft

What a person has typed and not yet sent. A draft is graph data like anything
else: kept by the store, one per person and place, and seen by every interface
the person uses (another tab, a terminal, another device) until it is sent or
discarded. It is never swept or given a lifetime; it ends when its text is
emptied, and the journal keeps every text it held, so a discard can be undone.

## Components

| component | what it is                                                                  |
| --------- | --------------------------------------------------------------------------- |
| `draft`   | `by` (the person), `place` (where it is typed), `text`, `rev` (stamped)     |
| `typed`   | an event beside a write of `draft.text`: `over`, the text it was typed over |

A draft's entity is `draftEid(by, place)`, so every interface finds the same
one. A place is whatever the interface names it: `<eid>.comment`,
`edit:<eid>:doc.title`, `search`.

## Two interfaces at once

Each write of a draft's text says what it was typed over. The store's hook
(`merging`, in `drafts()`) merges that write with what the store holds
(`merge`): changes to different parts of the text both apply; changes to the
same part keep both versions, the incoming first, unless one already holds the
other (a write sent again, or typed on from what the other side has), which is
taken once. Nothing either side typed is dropped. Every write counts one more
`rev`, so an interface hearing two answers keeps the newer.

## An interface's side

```ts ignore
import { desk } from '@yaks/draft'

let drafts = desk(client, { by: () => person, stash: localStorage })
drafts.type('T-5.comment', 'looks good') // text() answers at once
drafts.text('T-5.comment') // 'looks good', here and, soon, everywhere
drafts.spend('T-5.comment', commentBundles) // sent: emptied in one change
```

A keystroke costs no round trip. The text is kept in the stash (Web Storage,
which answers at once) until the store has it, so a crash, a closed tab or a
store out of reach loses nothing: the next load finds it there and sends it. The
store is written at most once a pace (`pace`, 500 ms) per draft, one write in
flight at a time; what was typed while one flew is merged onto its answer, and
so is every text another interface makes the store hold. A spend goes at once,
in the same change as the send it went into, so a refused send leaves the draft.

`client` is anything with a `mutate` answered by the change as the store applied
it, and a `watch`: a @yaks/client `client()` is one. `by` is read reactively;
while it is unknown, typing is kept and written once it is.

## Files

| file         | owns                                           |
| ------------ | ---------------------------------------------- |
| `vocab.json` | the `draft` component and the `typed` event    |
| `merge.ts`   | `merge`: two texts typed over one, made one    |
| `plugin.ts`  | `drafts()`: the plugin, and its `merging` hook |
| `desk.ts`    | `desk`, `draftEid`: an interface's drafts      |

## Compatibility

Deno, browsers and Workers: the package reaches no runtime API beyond
`setTimeout` and the Web Storage a caller passes it.

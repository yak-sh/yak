# @yaks/reach

A graph made of graphs. An eid names one entity everywhere, so a book one graph
holds and a loan another holds about it are one entity wearing two components.
@yaks/reach asks a question of several graphs at once and answers it as one
bundle per eid, and splits a write so each component lands in the graph its word
lives in. yaks.app reads and writes across a person's apps this way, one member
per app's store (workers/yak/reach.ts).

## Members

A **member** is a value (`Member`):

- `at`: where it is, the name a merged bundle gives a component's home;
- `read(line, {said, live})`: the bundles a filter line selects, or a reduction
  such as `{count}`. It throws to refuse;
- `apply(bundles, check)`: the batch as applied, or rehearsed and kept nowhere
  when `check` is set;
- `vocab()`: the words it declares as its own;
- `space`, `name` and `sandboxed`, optional: the members whose words agree on
  their shapes, what a caller calls it, and whether it takes only the writes
  aimed at it.

Where a member runs (a Durable Object, a remote host, a graph in memory) is the
caller's business.

## Use

`reach(words)` gives the operations over any set of members. `words.core` is the
vocabulary every member speaks; `union`, `hidden` and `silent` are optional (the
members' words as one vocabulary, a listing rule's hidden components, and a
report of a member left out of a read).

```ts ignore
import { reach } from '@yaks/reach'
import { loadVocab } from '@yaks/vocab'

const fan = reach({ core: loadVocab([]) })
const bundles = await fan.read(members, '.book&?loan')
await fan.written(members, undefined, [
  { entity: { eid: 'dune' }, book: { pages: 412 }, loan: { to: 'Ann' } },
])
```

## Reads

With one member, a read is that member's own answer. With several:

1. The line is cut on its `&` seams into one part per component named, and each
   part is asked of the members that declare that word (every member, for a word
   none declares).
2. The eids every part selected are the answer. A part that only asks for a
   component (`?loan`) is fetched, never intersected.
3. Each eid is gathered from every member and composed into one bundle. The
   first member to answer a component owns it, and `_stores` names each
   component's home when a bundle spans two.

Ranked hits interleave member by member. An `.order=` and its window run over
the merged bundles with @yaks/match, in the union of the members' words, since
the property sorted by may live in another member. `.count` counts the composed
set. A word two spaces declare with different properties is two words, so a
bundle wearing both is answered once per space.

A member that refuses or fails is left out of the answer, and reported through
`silent`. One that answers 503 fails the read, and so does a line every member
refuses.

## Writes

`routed` splits a batch into one part per member. Every `$alias` is minted once
for all of them, so a bundle landing in two members lands under one eid. A
component goes to the member that declares its word (the one already holding it,
else the named one, else the first declarer). A word no member declares goes to
the named member, the one already holding it, or the member whose own words are
in the same bundle. A death goes to every member holding the entity.

`written` rehearses every part, then commits them. A refusal in the rehearsal
leaves every member unwritten; one after it is marked `partial`, because another
part may have committed.

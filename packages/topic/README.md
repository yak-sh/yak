# @yaks/topic

A knowledge graph of topics. A topic is a subject, such as "data model" or
"testing", and a project is its own topic. Some topics are world knowledge and
some belong to a project; together they form a tree you can open, browse and
read, everything known about a subject is held under it, and every claim in it
leads back to who said it.

A topic is an entity (a record identified by `entity.eid`) carrying:

- `topic{name, scope}`: `name` is its title in lowercase with single spaces, and
  no two topics share one, so a name said twice is one topic. It is a name, not
  an identity: the eid is the entity's own, so any entity may wear `topic`, and
  a project does, to be its own topic. `scope` is the project it holds for,
  absent for a topic that holds everywhere.
- `doc{title, body}` ([@yaks/doc](../doc)), the **cover**: its title and a line
  or two saying what belongs under it, what a reader sees in a list and decides
  by.
- `content{body}` ([@yaks/tools](../tools)), the **contents**: what is
  understood about the subject, written as one document.

Its edges are relations that already exist, never new ones:

| Relation              | Package                   | Means                                                                |
| --------------------- | ------------------------- | -------------------------------------------------------------------- |
| `contains`            | [@yaks/task](../task)     | what it holds: a subtopic, or any other entity (a memory, a package) |
| `requires`            | [@yaks/task](../task)     | a topic to understand first                                          |
| `reads`, `references` | [@yaks/kernel](../kernel) | related things, listed but not held                                  |
| `cites{hash}`         | [@yaks/kernel](../kernel) | its sources: verbatim words, sessions, entries, memories             |

One relation is this package's own, and it arrives at a topic: `tends{}`, a link
from a [persona](../persona) to the topic it looks after, its **oracle**. The
oracle keeps the topic's cover, contents and edges true and answers what is
asked about it. `tends` puts nothing in the persona's context; what the persona
contains does, so an oracle also contains its topic. A topic's oracle is
`.tends->` the topic, and the topic page's head names it ("tended by").

Beliefs ([@yaks/memory](../memory)) are about topics (`belief{scope, about}`): a
memory marks what was said, a belief concludes something from memories and cites
them, and a topic's contents are written from its beliefs and cite them. So a
reader goes cover, contents, sources, and down the tree.

## Install

```sh
deno add jsr:@yaks/topic
```

## Use

```ts
import { fits, named, overlaps } from '@yaks/topic'
import { equal } from '@yaks/testing'

equal(named('  Data   Model '), 'data model')
equal(overlaps('economic market design', 'market design'), true)
equal(overlaps('ui design', 'cover design'), false)
equal(fits('Data Modeling', 'data model'), true)
```

A topic is **found** by what somebody says (`fits`): each word said starts one
of the topic's words (its name's, title's and cover's), as it is typed, or
shares its stem with one, so "data modeling" finds data model and "tests" finds
testing.

## The tools

`@yaks/topic/tools` exports `runs()`, the implementations behind the three tools
`vocab.json` declares (`yak topic find`, `yak topic new`, `yak topic add`, and
each over `/mcp`):

```sh
yak topic find model
yak topic find --near '#c625160bfa'
yak topic new testing --body 'what a test checks, and how fast a suite runs'
yak topic new billing --body 'plans, prices and invoices' --scope P-19
yak topic add Q-59416 M-14942 M-59035
yak topic add 'Task Graph' D-130781
yak topic add Q-59416 M-59035 --drop
```

`topic find` answers topics whole: those `said` finds (`fits`), ranked by
meaning to `near` where the server has embeddings, or else in order of name.

`topic new` makes a topic from a name, a cover and an optional scope. One name
is one topic, so it refuses a name that is taken, or whose words hold another
topic's or are held by them ("economic market design" beside "market design"),
and says which topic to use. Whoever makes a topic finds first, so a subject
already named is reused, and the name's unique index refuses the second of two
writers that found nothing at once.

`topic add` puts entities under a topic, a `contains` edge from the topic to
each, where whoever reads the topic finds them: a memory, a design, a skill, a
package, somebody's words, a subtopic. Adding one already there changes nothing,
and `--drop` takes them out. It refuses a topic that is not one, and a topic
holding itself. A project is its own topic, so a project's id or name places
things under it.

## The views

`@yaks/topic/views` draws the topics wherever the browsing app
([@yaks/browse](../browse)) does, in a browser and a terminal alike, as a
library's catalogue: the shelves on one side, the topic opened on the other.

The **shelves** are every topic as a tree: the topics no topic contains at the
top, each over the topics it contains, each level by title (`shelves`, pure).
Over them a field finds a topic by what is typed, narrowing the shelves to the
topics it finds under the topics holding them; Enter opens the first, and Escape
clears it. What is typed there is the person's draft, through the UX host's
`drafts` (@yaks/ux).

The sidebar offers them as **Topics** (`destinations`), at `/?topics`: every
topic with its cover (`Topics.Page`). A topic opens on its page, the `Topic`
tab, beside the shelves, titles only, the topic lit and the shelves holding it
open; stacked, as on a phone, the page comes first. The page alone is its
`Inspect.Page`, and a card's face (`Card.Topic`):

- the head: its title, what contains it, and where it holds (the project its
  scope names, or everywhere), each named from the answer that brought it;
- the cover's words, then the contents, as markdown;
- what it contains, what to understand first, what is related and its sources,
  each in edge order;
- the beliefs about it, newest first, and the archived ones on a press, muted;
- the comments on it, with a line to write one, where the host draws a thread
  (`Comments`; @yaks/kernel's in browse), each stamped as its writer's;
- then the facts, links and history any page has.

Whatever it holds or cites is drawn by that entity's own renderer, asked for as
`Topic.List.Tile`: a subtopic as its cover, a belief as what it states
(@yaks/memory), anything else as it reads in any list.

The `Tree` tab draws what a topic contains all the way down, each subtopic's
holdings nested under it. It walks only into topics, draws a topic met again on
its own path without walking it, and links to the rest past `DEPTH` levels.

## Exports

The root exports `topicDoc`, `named` (a title folded to a topic's name), `HOLDS`
(the relation a topic holds things by, `contains`), `overlaps` (whether two
names share a subject by their words), `fits` (whether what was said finds a
topic's words), `about` (a topic's words: name, title and cover), `found` (the
query that reads every topic), `shelves` and `within` (the topics as a tree, and
that tree narrowed to what was said), and the constants `TOPIC`, `FIND` and
`TOPICS`. `@yaks/topic/vocab` exports `topicDoc` and `docs: [topicDoc]` for
schema loaders. `@yaks/topic/views` exports `inspectViews()`, which loads the
shelves, the page, the tree and the tile; `tabs`, the two tabs a topic wears;
`destinations`, the Topics page the sidebar offers; and `icons`, the glyph it
wears.

## Compatibility

Pure TypeScript with no platform API, so it runs in a browser, on Deno and on
Node. The tools need a configured graph, and `near` a vector index. The views
are Preact components a host mounts through @yaks/inspect's contract.

## License

Apache-2.0

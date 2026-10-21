# @yaks/topic

A knowledge graph of topics. A topic is a subject no project, package, component
or design already is, such as "data model" or "testing". Some topics are world
knowledge and some belong to a project; together they form a tree you can open,
browse and read, and every claim in it leads back to who said it.

A topic is an entity (a record identified by `entity.eid`) carrying:

- `topic{name, scope}`: `name` is its title in lowercase with single spaces, and
  is its identity, so its id is derived from it and a name said twice is one
  topic. `scope` is the project it holds for, absent for a topic that holds
  everywhere.
- `doc{title, body}` ([@yaks/doc](../doc)), the **cover**: its title and a line
  or two saying what belongs under it, what a reader sees in a list and decides
  by.
- `content{body}` ([@yaks/tools](../tools)), the **contents**: what is
  understood about the subject, written as one document.

Its edges are relations that already exist, never new ones:

| Relation              | Package                   | Means                                                                 |
| --------------------- | ------------------------- | --------------------------------------------------------------------- |
| `contains`            | [@yaks/task](../task)     | what it holds: a subtopic, or any other entity (a project, a package) |
| `requires`            | [@yaks/task](../task)     | a topic to understand first                                           |
| `reads`, `references` | [@yaks/kernel](../kernel) | related things, listed but not held                                   |
| `cites{hash}`         | [@yaks/kernel](../kernel) | its sources: verbatim words, sessions, entries, memories              |

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
import { named, overlaps, topicEid } from '@yaks/topic'
import { equal } from '@yaks/testing'

equal(named('  Data   Model '), 'data model')
equal(topicEid('Data Model'), topicEid('data model'))
equal(overlaps('economic market design', 'market design'), true)
equal(overlaps('ui design', 'cover design'), false)
```

## The tools

`@yaks/topic/tools` exports `runs()`, the implementations behind the two tools
`vocab.json` declares (`yak topic find`, `yak topic new`, and each over `/mcp`):

```sh
yak topic find model
yak topic find --near '#c625160bfa'
yak topic new testing --body 'what a test checks, and how fast a suite runs'
yak topic new billing --body 'plans, prices and invoices' --scope P-19
```

`topic find` answers topics whole: those whose name or cover holds a word
starting with each word of `said` (`query` finds `querying`), ranked by meaning
to `near` where the server has embeddings, or with neither, in order of name.

`topic new` makes a topic from a name, a cover and an optional scope. One name
is one topic, so it refuses a name that is taken, or whose words hold another
topic's or are held by them ("economic market design" beside "market design"),
and says which topic to use. Whoever makes a topic finds first, so a subject
already named is reused, and the refusal catches two writers that found nothing
at once.

## The views

`@yaks/topic/views` draws a topic wherever the browsing app
([@yaks/browse](../browse)) does, in a browser and a terminal alike. A topic
opens on its page, the `Topic` tab, which is also its `Inspect.Page`:

- the head: its title, the topics that contain it, and where it holds (the
  project its scope names, or everywhere);
- the cover's words, then the contents, as markdown;
- what it contains, what to understand first, what is related and its sources,
  each in edge order;
- the beliefs about it, newest first, and the archived ones on a press, muted;
- then the facts, links and history any page has.

Whatever it holds or cites is drawn by that entity's own renderer, asked for as
`Topic.List.Tile`: a subtopic as its cover, a belief as what it states
(@yaks/memory), anything else as it reads in any list.

The `Tree` tab draws what a topic contains all the way down, each subtopic's
holdings nested under it. It walks only into topics, draws a topic met again on
its own path without walking it, and links to the rest past `DEPTH` levels.

## Exports

The root exports `topicDoc`, `named` (a title folded to a topic's name),
`topicEid` (the id a title names, whether or not it exists yet), `overlaps`
(whether two names share a subject by their words), `found` (the query
`topic find` reads), and the constants `TOPIC` and `FIND`. `@yaks/topic/vocab`
exports `topicDoc` and `docs: [topicDoc]` for schema loaders.
`@yaks/topic/views` exports `inspectViews()`, which loads the page, the tree and
the tile, and `tabs`, the two tabs a topic wears.

## Compatibility

Pure TypeScript with no platform API, so it runs in a browser, on Deno and on
Node. The tools need a configured graph, and `near` a vector index. The views
are Preact components a host mounts through @yaks/inspect's contract.

## License

Apache-2.0

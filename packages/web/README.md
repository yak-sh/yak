# @yaks/web

A graph in a browser, read-only: a home page, a search, and every entity at its
own address. `/T-9` opens T-9; `/T#8d83e663ef` opens an entity by the start of
its eid. Everything on screen is a live @yaks/client watch, so a page changes
when the graph does.

## Use

List it in a `yak serve` config beside @yaks/api, which serves the doors the
page reads through (`/query`, `/ws`):

```json
{
  "name": "yak",
  "plugins": ["@yaks/id", "@yaks/doc", "@yaks/task", "@yaks/api", "@yaks/web"]
}
```

The routes facet (`@yaks/web/routes`) answers `/`, `/<letter>-*` and `/<letter>`
for each id letter the vocabulary uses, and `/web/client.js`, `/web/style.css`
and `/web/vocab.json`. It claims no catch-all, so `/query`, `/ws` and every
other plugin's routes still reach their own handlers.

## Views

The page is drawn by portable [@yaks/render](../render) renderers, the same ones
a terminal prints through [@yaks/text](../text). `/web/client.js` is bundled on
first request from each configured plugin's `./views` and `./vocab` exports, in
config order, so a package that ships views is drawn as soon as a config lists
it. Today that is @yaks/doc (`Title`, `Body`), @yaks/task (`Status`) and
@yaks/session.

`@yaks/web/views` holds the views any entity has, registered last so a package
that knows its components wins by specificity:

| view      | draws                                                               |
| --------- | ------------------------------------------------------------------- |
| `Title`   | the id, for an entity with no title                                 |
| `Tile`    | a link: id, `Title`, `Status`                                       |
| `Facts`   | every component a page does not show elsewhere, one row each        |
| `Comment` | an entity with `comment`: its author, when, then its `Body`         |
| `Page`    | the whole entity: head, `Title`, `Body`, relations, comments, facts |

What one bundle cannot say arrives in the render context as a `Shown`: how an id
reads, what a referenced entity is called and where it links, how a time reads,
and `show(bundle, view)` to draw another entity through the same registry. A
page's relations and comments ride in it too. A terminal supplies the same
context with `tree` from @yaks/text as its `show`.

## Limits

- Read-only: no view writes.
- `/web/client.js` is built with `deno bundle`, which Deno marks experimental.
- A status is computed by the marks' default ladder in the browser; a rung
  another plugin adds (a claim's `wip`) is computed only by the server.

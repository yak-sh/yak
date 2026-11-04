# @yaks/preact

Renders graph records as Preact components using the view registry from
`@yaks/render`. A bundle is one entity's components as a JSON object, including
its `entity.eid`. A registry associates view names and matching predicates with
rendering functions. This package stores no entities and persists no edits.

Bind a synchronous function that reads bundles, and optionally a subscription,
into an `Entity` component, then mount it with Preact. This fragment assumes a
registry from `@yaks/render`, a loaded vocabulary, a bundle map and an
application subscription function `watch`:

```ts ignore
import { entity } from '@yaks/preact'
import { h, render } from 'preact'

let Entity = entity({
  registry,
  vocab,
  store: (eid) => bundles.get(eid),
  subscribe: (eid, notify) => watch(eid, notify), // returns an unsubscribe
})
render(h(Entity, { eid: 'a', view: 'Tile' }), document.body)
```

The JSX equivalent is `<Entity eid='a' view='Tile'/>`. Extra props flow to the
renderer context, including `comp` and `prop` for property views. The component
re-reads its store on notifications, handles absent bundles, and releases its
listener when the eid changes or it unmounts. It also reads after subscribing,
so a change between the first render and subscription is observed. Without a
subscription, parent renders still re-read the store. Create the bound `Entity`
once, outside a component's render.

`render(registry, bundle, view, vocab, ctx?)` directly builds a Preact node for
callers that already own the subscription. A missing bundle at `Entity`, or an
unmatched view, renders nothing. Portable renderers remain pure; native
components own hooks and state.

This package supplies `ctx.render(view, overrides?)` for composing another view
of the same bundle through the same registry. Overrides merge with the current
context; props belonging to a native component are preserved. A portable
`onChange` prop can carry an `Action` object; this package calls its
`run(bundle, input)` with a checkbox's checked state, or another control's
value, and passes the resulting patch to `ctx.onPatch(patch, bundle)`. The
application owns applying that patch. A rejected edit sets and reports the
control's validity message and calls `ctx.onError(error, bundle)` when supplied;
a successful edit clears the message. The exported `Events` type describes these
callbacks. Ordinary event functions pass through unchanged.

A native registration uses `{view, match, Render}` and can be typed as
`ComponentRenderer`. This package builds `h(Render, {e: bundle, ...ctx})`, so
Preact owns its hooks and its component identity. `Entity` supports native and
portable registrations in the same registry. A component change resets its state
and runs its cleanup through ordinary reconciliation.

For an application whose entities differ from `Bundle`, register
`ComponentRenderer<MyEntity>` and call
`render(registry, bundle, view, vocab, ctx, {e: entity, ...ctx})`. Selection
reads the bundle; the mounted component receives the original typed entity. A
native `Render` is never called as an ordinary function.

A bound `Entity` given `registry` as a function reads the registry at each
render, so a replaced registry draws on the next render without binding a new
`Entity`.

## Drawing a page from a views module

A **views module** is a page script that exports `views`, a `@yaks/render`
registry, the way a package's `/views` facet does. `@yaks/preact/host` exports
`host`, which imports a views module, binds its registry into an `Entity` and
draws the page into a root element. The page keeps its client and its page
graph; the host reads them through the `vocab`, `store` and `subscribe` that
`entity` takes, and never creates or closes them. This fragment needs a browser
page, so it is not run here:

```ts ignore
import { h } from 'preact'
import { host } from '@yaks/preact/host'

let page = await host({
  root: document.querySelector('main')!,
  views: new URL('./views.ts', import.meta.url),
  client: front,
  draw: (Entity) => h(Entity, { eid: 'page', view: 'Page' }),
})
```

`draw` returns what the root holds, so the page can wrap the `Entity` in its own
providers, such as `@yaks/ux`'s `Ux`. `page.registry()` is the registry drawn
now, and `page.close()` stops following writes and empties the root. A `load`
option replaces `import()`, for a test that supplies modules itself. A page can
also supply `vocab`, `store` and `subscribe` separately, with `extend` to adopt
a larger vocabulary.

### A preview that takes a write in place

On a yaks.app draft preview link, each write to the app's draft reaches the page
as a cancelable `yak-draft` event on `window`, whose `detail.files` names each
file written, its sha, its address and the page entries its imports reach. When
a write reaches only the views module, the host cancels the event, so the page
does not reload, and then:

1. imports the new module from the views module's address with
   `?yak-draft=<sha>` added, so the browser imports it again;
2. replaces the registry and draws again into the same root, through the same
   Preact tree; the client, its socket and the page graph are never closed;
3. puts back the window's scroll, each scrolled element's scroll, and the
   focused element and its caret, wherever the draw replaced those elements.

A portable renderer's output is patched in place, so its elements, focus and
scroll stay as they are. A native renderer whose `Render` is a new function
remounts its subtree: Preact runs the old component's cleanup and mounts the new
one. State kept in the page graph survives the remount; state kept in hooks does
not. A component that skips its render (`memo`) draws the new renderers the next
time it renders.

A `vocab.json` write fetches the page vocabulary from `api/vocab.json` (override
with `vocabulary`, relative to the page's base URI). The client adopts it only
when every existing component keeps its declaration and only new components are
added. The graph, socket, watches and stored drafts stay open; new renderers
read the larger vocabulary. A changed or removed declaration reloads instead. A
write containing both vocabulary and views adopts the vocabulary first. The
`fetch` option supplies the vocabulary fetch in an in-process check.

When the new module throws on import, exports no registry, or throws during its
first draw, the host keeps the old registry, draws it again and calls the
event's `reload()`, the reload the page would have had, keeping its scroll and
typed fields. When writes land faster than their modules import, only the newest
is drawn. `taken(detail, views)` is the test the host applies: the sha to
import, or null.

A write that names any other file reaches the page's own handling: a stylesheet
the page links is swapped, and anything else reloads the page. That includes a
file the views module imports, `vocab.json`, and `index.html`. A change of page
vocabulary reloads too, since a running page graph keeps the vocabulary it was
created with.

The views module meets the page's own Preact and toolkit instances only when it
is compiled as its own page entry: load it from the page with
`<script type="module" src="views.ts"></script>` beside the main script, and do
not import it from the main script. yaks.app compiles each module script a page
loads as an entry that imports Preact, Signals and the `@yaks/` packages from
shared modules, and the new module imports the same shared modules. An app file
that both the main script and the views module import is bundled into each, so
keep state in the page graph, not in module variables. Outside a preview link no
`yak-draft` event arrives, and the host only draws.

## Example

From this directory, run `deno task example`, then open the loopback address it
prints. The example page demonstrates one portable renderer, a function store,
and a button that updates it through the subscription interface.

The example serves TypeScript as individual JavaScript modules using the same
Sucrase stripping as the application, with an import map pointing at Preact's
ESM on esm.sh. No bundler or `node_modules` is needed. It runs from this
repository; it is excluded from publication.

## Compatibility

Deno and Node for module loading and rendering with an injected DOM; browsers
for mounting. Imports `preact` and `preact/hooks`, using the repository's Preact
10 version. Both names must resolve to the same Preact instance. A browser can
map them to esm.sh as the example does. The package itself has no Deno globals
and never installs a global document.

## Verification

`deno task test packages/preact` mounts through Preact using a temporary
LinkeDOM document, and checks the node example. The host's tests draw a page
over a `@yaks/client` page graph and dispatch `yak-draft` events on that
document's window.

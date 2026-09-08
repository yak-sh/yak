# @yaks/preact

Preact's host for `@yaks/render`. Bind a synchronous bundle store and optional
subscription into an `Entity` component, then mount it with Preact:

```ts
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
renderer context, including `comp` and `col` for column views. The component
re-reads its store on notifications, handles absent bundles, and releases its
listener when the eid changes or it unmounts. It also reads after subscribing,
so a change between the first render and subscription is observed. Without a
subscription, parent renders still re-read the store. Create the bound `Entity`
once, outside a component's render.

`render(registry, bundle, view, vocab, ctx?)` directly builds a Preact node for
callers that already own the subscription. A missing bundle at `Entity`, or an
unmatched view, renders nothing. Portable renderers remain pure; native
components own hooks and state.

The host supplies `ctx.render(view, overrides?)` for composing another view of
the same bundle through the same registry. Overrides merge with the current
context; native source props are preserved. Portable `onChange` props can carry
an `Action` object. The host calls its `run(bundle, input)` with a checkbox's
checked state or another control's value, then sends the resulting patch to
`ctx.onPatch(patch, bundle)`. The application owns applying that patch. A
rejected edit sets and reports the control's validity message and calls
`ctx.onError(error, bundle)` when supplied; a successful edit clears the
message. The exported `Events` type describes these callbacks. Ordinary event
functions pass through unchanged.

A native registration uses `{view, match, Render}` and can be typed as
`ComponentRenderer`. The host builds `h(Render, {e: bundle, ...ctx})`, so Preact
owns its hooks and component identity. `Entity` supports native and portable
registrations in the same registry. A component change resets its state and runs
its cleanup through ordinary reconciliation.

For an application whose entities differ from `Bundle`, register
`ComponentRenderer<MyEntity>` and call
`render(registry, bundle, view, vocab, ctx, {e: entity, ...ctx})`. Selection
reads the bundle; the mounted component receives the original typed entity. The
host never calls a native `Render` as an ordinary function.

## Example

From this directory, run `deno task example`, then open the loopback address it
prints. The yaks.app page demonstrates one portable renderer, a function store,
and a button that updates it through the subscription seam.

The example serves TypeScript as individual JavaScript modules using the same
Sucrase stripping as the application, with an import map pointing at the
existing plain ESM Preact files in `src/vendor`. No bundler or `node_modules` is
needed. It runs from this repository; it is excluded from publication.

## Compatibility

Deno and Node for module loading and rendering with an injected DOM; browsers
for mounting. Imports `preact` and `preact/hooks`, using the repository's Preact
10 version. Both names must resolve to the same Preact instance. A browser can
map them to vendored ESM as the example does. The package itself has no Deno
globals and never installs a global document.

## Verification

`deno test packages/preact/` mounts through Preact using a temporary LinkeDOM
document. `deno test --doc packages/preact/mod.ts` checks the node example.

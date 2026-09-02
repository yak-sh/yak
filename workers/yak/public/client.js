// The store an app's own pages talk to: one ES module, no build, served by
// the kernel at `<space>.yaks.app/<app>/api/client.js` beside the doors it
// wraps. A page writes `import { apply, query, search } from './api/client.js'`
// and has the app's graph — the same bundle shape the MCP tools speak
// (`{entity: {eid}, ...components}`, a `$alias` wherever an eid goes), entity
// JSON back. Nothing to install and nothing to configure: the module's own
// address IS the app's api directory, so a page at any depth reaches its own
// store, and the browser's cookie says who is asking.
//
// `store(base)` is those three doors at an address you name, and what the
// bound trio is made of. Every app in a space shares one hostname, so
// `store('/other/api/')` reads a sibling app's graph the same way.
//
// Errors need no wiring here: the kernel injects a reporter into every page
// it serves (public/report.js), so a throw, an uncaught rejection, or a
// refusal from these doors is already on its way to the app's store and the
// person's agent. Catch what you want to SHOW; the telling is done.
//
// A refusal is thrown with the server's own words — 'not a writer of jeff',
// or what the store said about the batch — because that sentence is what the
// person's agent reads next (D-32318 §Errors are surfaced).

let door = (base) => async (path, init) => {
  let r = await fetch(new URL(path, base), init)
  let body = await r.text()
  if (!r.ok) throw new Error(body || `${r.status} ${r.statusText}`)
  return body ? JSON.parse(body) : null
}

export let store = (base) => {
  let ask = door(base)
  // One bundle or many, in; `{ok, changes, aliases}` back, where `aliases`
  // maps each `$alias` to the eid it minted.
  let apply = (bundles) =>
    ask('apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: Array.isArray(bundles) ? bundles : [bundles],
      }),
    })
  // The filter line, the grammar the boards speak: '.doc.title~=cake',
  // '.opaque.format=recipe', 'id=<eid>', 'limit=', 'after='. Newest first.
  let query = (filter = '') => ask(`query?${filter}`)
  // Full-text over the docs, ranked; a filter may ride along.
  let search = (text, filter = '') =>
    query(`${encodeURIComponent(text)}${filter ? `&${filter}` : ''}`)
  return { apply, query, search }
}

export let { apply, query, search } = store(new URL('.', import.meta.url))

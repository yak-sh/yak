// A read door over a fixed Snapshot, for tests that drive client.ts without a
// database. It answers /query with the REAL grammar — the filter line parses
// through query.ts and matches rows the way the server's own pipeline does,
// plus the `id=` parameter that rides beside it. Kind is a filter now
// (`.kind=session`), parsed like any pred. A stub that ignored a predicate
// would let a narrow read pass by being answered broadly, which is exactly the
// mistake these tests exist to catch.

import { find, jsonOf, rows } from './client.ts'
import { kidsOf, matchQuery, parseQuery } from './query.ts'
import type { Change, Snapshot } from './types.ts'
import type { Mutation } from './mutation.ts'

export let answers = (snap: Snapshot) => {
  let all = rows(snap)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let kids = kidsOf(new Map(all.map((r) => [r.eid, r.comps])))
  // A hit's edges both ways — the `deps=1` layer the server attaches, read
  // off the fixed snapshot so the double agrees with the real /query.
  let edgesOf = (eid: string) =>
    snap.deps.filter((d) => d.parent == eid || d.child == eid)
  return (search: string) => {
    let segs = search.split('&').filter(Boolean)
    let edged = segs.includes('deps=1')
    let named = segs.filter((s) => s.startsWith('id='))
      .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
    let eids = new Set(named.map((id) => find(all, id)?.eid).filter(Boolean))
    // The same non-filter parameters the real /query door strips before it
    // parses predicates (server.ts): `id=` fetches by address, `after=`/`limit=`
    // page the lazy entry partition, and deps/backlinks/quarantined are flags.
    // Leaving a pagination param in would parse it as a bogus text pred and
    // filter every row out — which is how a paginated CLI read (task transcript)
    // silently reads nothing against this fake.
    let line = segs.filter((s) =>
      !s.startsWith('id=') && !s.startsWith('after=') &&
      !s.startsWith('limit=') &&
      s != 'deps=1' && s != 'backlinks=1' && s != 'quarantined=1'
    ).join('&')
    // Same reading as the real doors: `id=` already selected, a remaining
    // filter only screens — and no remaining filter means no screen (an empty
    // QUERY selects nothing, so parsing '' here would drop every named hit).
    // With no id= either, parseQuery('') mints the never-pred: empty answer.
    let preds = line.trim() || !named.length ? parseQuery(line) : []
    return all.filter((r) =>
      matchQuery(r.comps, preds, (e) => byEid.get(e)?.comps, undefined, kids) &&
      (!named.length || eids.has(r.eid))
    ).map((r) => edged ? { ...jsonOf(r), deps: edgesOf(r.eid) } : jsonOf(r))
  }
}

// `seen` is every line the client asked for, in order — how a test says what
// a verb read; `acked` collects the batches it wrote, since the bus's stamp
// is half of its contract.
export let fakeGraph = (snap: Snapshot) => {
  let seen: string[] = []
  let acked: Change[] = []
  let mutations: Mutation[] = []
  let answer = answers(snap)
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, async (req) => {
    let url = new URL(req.url)
    seen.push(decodeURIComponent(`${url.pathname}${url.search}`))
    if (req.method == 'POST' && url.pathname == '/apply') {
      let mutation = await req.json() as Mutation
      mutations.push(mutation)
      let changes = Array.isArray(mutation) ? mutation : []
      acked.push(...changes)
      return Response.json({ ok: true, changes })
    }
    if (url.pathname == '/snapshot') return Response.json(snap)
    return Response.json(answer(decodeURIComponent(url.search.slice(1))))
  })
  let port = (server.addr as Deno.NetAddr).port
  return { server, seen, acked, mutations, host: `127.0.0.1:${port}` }
}

// A read door over a fixed Snapshot, for tests that drive client.ts without a
// database. It answers /query with the REAL grammar — the filter line parses
// through query.ts and matches rows the way the server's own pipeline does,
// plus the `id=` and `kind=` parameters that ride beside it. A stub that
// ignored a predicate would let a narrow read pass by being answered broadly,
// which is exactly the mistake these tests exist to catch.

import { idOf, jsonOf, type Row, rows } from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import type { Change, Snapshot } from './types.ts'

export let answers = (all: Row[]) => {
  let byEid = new Map(all.map((r) => [r.eid, r]))
  return (search: string) => {
    let segs = search.split('&').filter(Boolean)
    let kind = segs.find((s) => s.startsWith('kind='))?.slice(5)
    let named = segs.filter((s) => s.startsWith('id='))
      .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
    let preds = parseQuery(
      segs.filter((s) => !s.startsWith('id=') && !s.startsWith('kind='))
        .join('&'),
    )
    return all.filter((r) =>
      matchQuery(r.comps, preds, (e) => byEid.get(e)?.comps) &&
      (!kind || r.kind == kind) &&
      (!named.length || named.includes(r.eid) || named.includes(idOf(r)))
    ).map((r) => jsonOf(r))
  }
}

// `seen` is every line the client asked for, in order — how a test says what
// a verb read; `acked` collects the batches it wrote, since the bus's stamp
// is half of its contract.
export let fakeGraph = (snap: Snapshot) => {
  let seen: string[] = []
  let acked: Change[] = []
  let answer = answers(rows(snap))
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, async (req) => {
    let url = new URL(req.url)
    seen.push(decodeURIComponent(`${url.pathname}${url.search}`))
    if (req.method == 'POST' && url.pathname == '/apply') {
      let changes = await req.json() as Change[]
      acked.push(...changes)
      return Response.json({ ok: true, changes })
    }
    if (url.pathname == '/snapshot') return Response.json(snap)
    return Response.json(answer(decodeURIComponent(url.search.slice(1))))
  })
  let port = (server.addr as Deno.NetAddr).port
  return { server, seen, acked, host: `127.0.0.1:${port}` }
}

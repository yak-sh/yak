// End-to-end probe for query subscriptions (T-6828). Spawns a scratch server
// (unique port, throwaway DB_PATH — never the live db), then proves BOTH doors:
//   A. legacy — an unadvertised socket gets bare arrays while an advertised
//      socket gets cursor envelopes; both still hear full broadcasts.
//   B. subscription — a `.comment.target=<S>` socket hears exactly its
//      matches (add via HTTP/cast AND via /ws), not unrelated writes, gets a
//      `drop` when a member re-points away, and an entity-null when a member
//      dies. Cleans up every entity it mints.
//   C. shadow — a board subscription keeps the complete live stream while its
//      parallel set maintains every own-component operator.
// Run: deno run -A --unstable-net --unstable-worker-options scripts/subs_probe.ts

let port = () => {
  let asked = Number(Deno.env.get('PORT'))
  if (asked) return asked
  let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let found = (listener.addr as Deno.NetAddr).port
  listener.close()
  return found
}
let PORT = port()
let DB = await Deno.makeTempFile({ suffix: '.db' })
let uuid = () => crypto.randomUUID()
let pass = true
let ok = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  pass = pass && cond
}

let server = new Deno.Command('deno', {
  args: [
    'run',
    '-A',
    '--unstable-net',
    '--unstable-worker-options',
    'src/server.ts',
  ],
  env: { ...Deno.env.toObject(), PORT: String(PORT), DB_PATH: DB },
  stdout: 'null',
  stderr: 'null',
}).spawn()

let base = `http://127.0.0.1:${PORT}`
// Wait for the server to answer /snapshot.
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${base}/snapshot`)).ok) break
  } catch { /* still booting */ }
  await new Promise((r) => setTimeout(r, 100))
}

// A joined socket with a frame queue + an awaitable matching frame.
let open = async (envelope = false) => {
  let held = await (await fetch(`${base}/snapshot`)).json()
  let s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
  let frames: unknown[] = []
  let wake: (() => void) | null = null
  s.onmessage = (m) => {
    frames.push(JSON.parse(String(m.data)))
    wake?.()
  }
  await new Promise((r) => (s.onopen = () => r(null)))
  // Wait up to `ms` for a frame matching `pick`, returning it (or null).
  let want = async (
    pick: (f: unknown) => boolean,
    ms = 800,
  ): Promise<unknown> => {
    let deadline = Date.now() + ms
    for (;;) {
      let hit = frames.find(pick)
      if (hit) return hit
      if (Date.now() > deadline) return null
      await new Promise<void>((r) => {
        wake = r
        setTimeout(r, deadline - Date.now())
      })
    }
  }
  send(s, {
    since: held.cursor,
    epoch: held.epoch,
    vocab: held.vocabHash,
    ...(envelope ? { live: 1 } : {}),
  })
  await want((f) => !!f && typeof f == 'object' && 'catchup' in f)
  return { s, frames, want }
}

let send = (s: WebSocket, v: unknown) => s.send(JSON.stringify(v))
let apply = (changes: unknown[]) =>
  fetch(`${base}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })

let live = (f: unknown) =>
  Array.isArray(f) ? f as { eid: string }[] : f && typeof f == 'object' &&
      Array.isArray((f as { live?: unknown }).live)
    ? (f as { live: { eid: string }[] }).live
    : null
let subFrame = (id: string) => (f: unknown) =>
  !!f && typeof f == 'object' && (f as { sub?: string }).sub == id

try {
  // ---- Door A: legacy full rebroadcast, untouched -------------------------
  let a = await open()
  let b = await open() // b never subscribes — stays a legacy client
  let next = await open(true)
  let shapes = async (origin: string, eid: string) => {
    let heard = await b.want((f) => !!live(f)?.some((c) => c.eid == eid))
    let framed = await next.want((f) => !!live(f)?.some((c) => c.eid == eid))
    ok(
      `A: ${origin} sends an unadvertised socket a bare Change[]`,
      Array.isArray(heard),
    )
    ok(
      `A: ${origin} sends an advertised socket a {live, cursor} envelope`,
      !!framed && !Array.isArray(framed) &&
        typeof (framed as { cursor?: unknown }).cursor == 'number',
    )
  }
  let mark = uuid()
  send(a.s, [{ eid: mark, name: 'doc', comp: { title: 'legacy-probe' } }])
  await shapes('a WS write', mark)
  let castMark = uuid()
  await apply([{
    eid: castMark,
    name: 'doc',
    comp: { title: 'cast-probe' },
  }])
  await shapes('the cast path', castMark)

  // ---- Door B: subscription filtering -------------------------------------
  // A target entity S, then a socket subscribing comments aimed at it.
  let S = uuid()
  await apply([{ eid: S, name: 'doc', comp: { title: 'target-S' } }])
  let c = await open()
  send(c.s, { sub: 'b1', q: `.comment.target=${S}` })
  let init = await c.want(subFrame('b1'))
  ok('B: subscribe returns an initial {sub} frame', !!init)

  // A legacy socket to confirm the legacy door keeps working alongside subs.
  let d = await open()

  // Add a member via the HTTP/cast path (proves MCP/HTTP writes reach subs).
  let cm = uuid()
  await apply([
    { eid: cm, name: 'doc', comp: { title: '', body: 'hello S' } },
    { eid: cm, name: 'comment', comp: { target: S } },
  ])
  let addF = await c.want((f) =>
    subFrame('b1')(f) &&
    (f as { changes: { eid: string }[] }).changes.some((x) => x.eid == cm)
  ) as { changes: { eid: string; name: string }[]; drop: string[] } | null
  ok('B: a matching comment (via HTTP/cast) arrives as a {sub} frame', !!addF)
  ok(
    'B: the add frame carries the comment full comps (doc + comment)',
    !!addF && addF.changes.some((x) => x.name == 'comment') &&
      addF.changes.some((x) => x.name == 'doc'),
  )
  ok(
    'B: the legacy socket also heard the comment (both doors coexist)',
    !!(await d.want((f) => !!live(f)?.some((x) => x.eid == cm))),
  )

  // An unrelated write over /ws — the subscriber must NOT receive it.
  let noise = uuid()
  c.frames.length = 0
  send(d.s, [{ eid: noise, name: 'doc', comp: { title: 'unrelated' } }])
  let leaked = await c.want((f) =>
    subFrame('b1')(f) &&
      (f as { changes: { eid: string }[] }).changes.some((x) =>
        x.eid == noise
      ) ||
    !!live(f)?.some((x) => x.eid == noise), 1000)
  ok('B: an unrelated write does NOT reach the subscriber', !leaked)

  // Re-point the comment at a DIFFERENT entity — it leaves the query but
  // still exists (target FKs to a live spine, so the new aim must exist).
  let S2 = uuid()
  await apply([{ eid: S2, name: 'doc', comp: { title: 'target-S2' } }])
  c.frames.length = 0
  await apply([{ eid: cm, name: 'comment', comp: { target: S2 } }])
  let dropF = await c.want((f) =>
    subFrame('b1')(f) &&
    (f as { drop: string[] }).drop.includes(cm)
  )
  ok('B: re-pointing a member away sends a `drop` for it', !!dropF)

  // Re-point back (re-add), then delete it — the death reaches the subscriber
  // as an entity-null inside `changes`.
  await apply([{ eid: cm, name: 'comment', comp: { target: S } }])
  await c.want((f) =>
    subFrame('b1')(f) &&
    (f as { changes: { eid: string }[] }).changes.some((x) => x.eid == cm)
  )
  c.frames.length = 0
  await apply([{ eid: cm, name: 'entity', comp: null }])
  let deathF = await c.want((f) =>
    subFrame('b1')(f) &&
    (f as { changes: { eid: string; name: string; comp: unknown }[] }).changes
      .some((x) => x.eid == cm && x.name == 'entity' && x.comp == null)
  )
  ok('B: deleting a member forwards an entity-null to the subscriber', !!deathF)

  // ---- Door C: shadow agreement beside the complete stream ----------------
  let shadow = await open(true)
  let sub = 'board:probe'
  let matrix: [
    string,
    string,
    Record<string, unknown>,
    Record<string, unknown>,
  ][] = [
    ['equality', '.status=open', { status: 'open' }, { status: 'done' }],
    ['list', '.domain=Ops,Eng', { domain: 'Ops' }, { domain: 'Web' }],
    ['range', '.priority=1..3', { priority: 3 }, { priority: 4 }],
    ['inequality', '.status!=done', { status: 'open' }, { status: 'done' }],
    ['contains', '.title~=flux', { title: 'Flux gate' }, {
      title: 'Warp gate',
    }],
  ]
  let shadowEids: string[] = []
  for (let [name, q, inside, outside] of matrix) {
    shadow.frames.length = 0
    send(shadow.s, { sub, q, shadow: true })
    ok(`C: ${name} shadow opens`, !!(await shadow.want(subFrame(sub))))

    let eid = uuid()
    shadowEids.push(eid)
    shadow.frames.length = 0
    await apply([
      {
        eid,
        name: 'doc',
        comp: { title: String(inside.title ?? name), body: '' },
      },
      {
        eid,
        name: 'task',
        comp: {
          status: String(inside.status ?? 'open'),
          priority: Number(inside.priority ?? 1),
          domain: inside.domain == null ? null : String(inside.domain),
        },
      },
    ])
    ok(
      `C: ${name} add rides the shadow set`,
      !!(await shadow.want((f) =>
        subFrame(sub)(f) &&
        (f as { changes: { eid: string }[] }).changes.some((x) => x.eid == eid)
      )),
    )
    ok(
      `C: ${name} add also rides the complete stream`,
      !!(await shadow.want((f) => !!live(f)?.some((x) => x.eid == eid))),
    )

    shadow.frames.length = 0
    let comp = q.includes('title') ? 'doc' : 'task'
    await apply([{ eid, name: comp, comp: outside }])
    ok(
      `C: ${name} moving out sends a drop`,
      !!(await shadow.want((f) =>
        subFrame(sub)(f) && (f as { drop: string[] }).drop.includes(eid)
      )),
    )
    ok(
      `C: ${name} drop still rides the complete stream`,
      !!(await shadow.want((f) => !!live(f)?.some((x) => x.eid == eid))),
    )

    shadow.frames.length = 0
    await apply([{ eid, name: comp, comp: inside }])
    ok(
      `C: ${name} moving back re-adds`,
      !!(await shadow.want((f) =>
        subFrame(sub)(f) &&
        (f as { changes: { eid: string }[] }).changes.some((x) => x.eid == eid)
      )),
    )
  }

  send(shadow.s, { unsub: sub })
  let after = uuid()
  shadowEids.push(after)
  shadow.frames.length = 0
  await apply([{ eid: after, name: 'doc', comp: { title: 'after shadow' } }])
  ok(
    'C: closing a shadow keeps the socket on the complete stream',
    !!(await shadow.want((f) => !!live(f)?.some((x) => x.eid == after))),
  )

  // ---- cleanup ------------------------------------------------------------
  await apply([
    { eid: S, name: 'entity', comp: null },
    { eid: S2, name: 'entity', comp: null },
    { eid: mark, name: 'entity', comp: null },
    { eid: castMark, name: 'entity', comp: null },
    { eid: noise, name: 'entity', comp: null },
    ...shadowEids.map((eid) => ({ eid, name: 'entity', comp: null })),
  ])
  for (let x of [a, b, next, c, d, shadow]) x.s.close()
} finally {
  server.kill('SIGTERM')
  await server.status
  await Deno.remove(DB).catch(() => {})
  await Deno.remove(DB + '-journal').catch(() => {})
  await Deno.remove(DB + '-wal').catch(() => {})
  await Deno.remove(DB + '-shm').catch(() => {})
}

console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
Deno.exit(pass ? 0 : 1)

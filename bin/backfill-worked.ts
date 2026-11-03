// One-time backfill (T-45592): a `worked` edge from each past session to what
// it claimed. `claim` is not journaled, so the takes are read from what
// recorded them: a done claim_take call (its session in `created.via`), a
// spawned session (its `session_spawn` call's `task`), and the claims held now.
// Links derive their eids, so a second run writes nothing.
//
//   deno run -A bin/backfill-worked.ts [--check]

import { link } from '@yaks/edge'

let yak = async (...args: string[]) => {
  let out = await new Deno.Command('yak', { args: [...args, '--json'] })
    .output()
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  return JSON.parse(new TextDecoder().decode(out.stdout)).result as any[]
}
let q = (query: string) => yak('graph', 'query', query)
let tool = async (name: string) =>
  (await q(`.tool.name=${name}&.fields=entity.eid`))[0].entity.eid as string

let pairs: [string, string][] = []
for (
  let c of await q(
    `.call.to=${await tool('claim_take')}&.execution.state=done` +
      '&.fields=call.args,created.via&.limit=100000',
  )
) {
  let on = c.call?.args?.target ?? c.call?.args?.task
  if (c.created?.via && on) pairs.push([c.created.via, String(on)])
}
// a spawned session, paired with its spawn call by `session.source`
let spawned = await q(
  `.session.source.call.to=${await tool('session_spawn')}` +
    '&.fields=entity.eid,session.source&.limit=100000',
)
let calls = new Map(
  (await q(
    `.call.to=${await tool(
      'session_spawn',
    )}&.fields=entity.eid,call.args&.limit=100000`,
  )).map((c) => [c.entity.eid, c.call?.args?.task]),
)
for (let s of spawned) {
  let task = calls.get(s.session?.source)
  if (task) pairs.push([s.entity.eid, String(task)])
}
for (
  let c of await q('.claim&.fields=entity.eid,claim.session&.limit=100000')
) {
  if (c.claim?.session) pairs.push([c.claim.session, c.entity.eid])
}

// human ids (T-12) to eids, and which ends exist
let nums = [
  ...new Set(pairs.map(([, t]) => t).filter((t) => /^[A-Z]-\d+$/.test(t))),
]
let eidOf = new Map<string, string>()
for (let i = 0; i < nums.length; i += 200) {
  let chunk = nums.slice(i, i + 200)
  let n = chunk.map((t) => t.split('-')[1]).join(',')
  for (
    let b of await q(
      `.entity.num=${n}&.fields=entity.eid,entity.num&.limit=1000`,
    )
  ) {
    for (let t of chunk) {
      if (t.endsWith(`-${b.entity.num}`)) eidOf.set(t, b.entity.eid)
    }
  }
}
let resolved = pairs.map(([s, t]) => [s, eidOf.get(t) ?? t] as [string, string])
let ends = [...new Set(resolved.flat())].filter((e) =>
  /^[0-9a-f-]{36}$/.test(e)
)
let live = new Set<string>()
for (let i = 0; i < ends.length; i += 200) {
  for (
    let b of await q(
      `.entity.eid=${
        ends.slice(i, i + 200).join(',')
      }&.fields=entity.eid&.limit=1000`,
    )
  ) {
    live.add(b.entity.eid)
  }
}
let sessions = new Set<string>()
for (let i = 0; i < ends.length; i += 200) {
  for (
    let b of await q(
      `.session&.entity.eid=${
        ends.slice(i, i + 200).join(',')
      }&.fields=entity.eid&.limit=1000`,
    )
  ) {
    sessions.add(b.entity.eid)
  }
}
let have = new Set(
  (await q('.worked&.fields=edge.from,edge.to&.limit=100000'))
    .map((e) => `${e.edge.from}|${e.edge.to}`),
)
let want = new Map<string, [string, string]>()
for (let [s, t] of resolved) {
  if (!sessions.has(s) || !live.has(t) || s == t) continue
  if (!have.has(`${s}|${t}`)) want.set(`${s}|${t}`, [s, t])
}
console.log(
  `${pairs.length} takes found, ${have.size} edges already, ${want.size} to write`,
)
let bundles = [...want.values()].map(([s, t]) => link(s, 'worked', t))
let check = Deno.args.includes('--check') ? ['--check'] : []
for (let i = 0; i < bundles.length; i += 200) {
  await yak(
    'graph',
    'apply',
    '--bundles',
    JSON.stringify(bundles.slice(i, i + 200)),
    ...check,
  )
}
console.log(`${check.length ? 'checked' : 'wrote'} ${bundles.length}`)

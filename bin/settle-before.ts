// One-off (T-144129): archive the owner's copy of each break in a person's app
// whose platform bug was resolved before bug_settle tagged its occurrences
// (35f8cdf7a). It reads the platform's resolved bugs and their `source: app`
// occurrences, finds each one's owner copy among the space's error rows (same
// app, request and message, captured within five seconds before), and archives
// the open ones through POST /settle with the reason bug_settle gives.
//
//   deno run -A bin/settle-before.ts <slug>=<space eid>... [--live]
import { peek } from '@yaks/secrets'
import { request } from '@yaks/tracker/remote'
import { vaultOf } from '../packages/cli/vault.ts'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>
let remote = {
  url: 'https://yak-tracker.yaks.workers.dev',
  secret: peek(
    vaultOf(`${Deno.env.get('HOME')}/.yak/yak.db`),
    'TRACKER_SECRET',
  ),
}
let call = async (path: string, scope: string, q?: string, body?: unknown) => {
  let r = await request(
    remote,
    path,
    new URLSearchParams({ scope, ...q ? { q } : {} }),
    body
      ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
      : {},
  )
  if (!r.ok) throw Error(`${path} ${r.status} ${await r.text()}`)
  return await r.json()
}
let ask = (scope: string, q: string): Promise<Row[]> => call('query', scope, q)

let live = Deno.args.includes('--live')
let spaces = Object.fromEntries(
  Deno.args.filter((a) => a.includes('=')).map((a) => a.split('=')),
)
let copies: Record<string, { bug: Row; o: Row }[]> = {}
for (let bug of await ask('platform', '.bug .resolved * .limit=1000')) {
  for (
    let o of await ask(
      'platform',
      `.error .error.bug=${bug.entity.eid} * .limit=1000`,
    )
  ) {
    let t = o.error.tags ?? {}
    if (t.source != 'app' || t.scope || o.error.at > bug.resolved.at) continue
    ;(copies[t.space] ??= []).push({ bug, o })
  }
}
for (let [slug, list] of Object.entries(copies)) {
  let scope = spaces[slug]
  if (!scope) throw Error(`no space eid given for ${slug}`)
  let rows = await ask(scope, '.error .during.app * .limit=1000')
  let open = () => rows.filter((r) => !r.archived).length
  let before = open(), unmatched = 0
  let settle = new Map<string, { reason: string; eids: Set<string> }>()
  for (let { bug, o } of list) {
    let gap = (r: Row) => Date.parse(o.error.at) - Date.parse(r.error.at)
    let [owned] = rows.filter((r) =>
      r.error.tags?.app == o.error.tags.app &&
      r.error.tags?.request == o.error.tags.request &&
      r.exception?.value == o.exception?.value && gap(r) >= 0 && gap(r) < 5000
    ).sort((a, b) => gap(a) - gap(b))
    if (!owned) {
      unmatched++
      continue
    }
    if (owned.archived) continue
    let at = settle.get(bug.entity.eid) ?? {
      reason: `Fixed by yaks.app: ${bug.resolved.cause}`,
      eids: new Set(),
    }
    settle.set(bug.entity.eid, at.eids.add(owned.entity.eid) && at)
  }
  let settled = 0
  for (let { reason, eids } of settle.values()) {
    if (live) {
      settled +=
        (await call('settle', scope, undefined, { eids: [...eids], reason }))
          .settled
    } else settled += eids.size
  }
  let after = live
    ? (await ask(scope, '.error .during.app !archived * .limit=1000')).length
    : before - settled
  console.log(
    `${slug}: ${list.length} platform copies, ${unmatched} unmatched; open app occurrences ${before} -> ${after} (${
      live ? 'settled' : 'would settle'
    } ${settled})`,
  )
}

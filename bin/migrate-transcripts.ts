#!/usr/bin/env -S deno run -A
// One-time (T-38305): transcript entries the harness wrote before 2026-09-22
// hold an OpenAI Responses item as raw JSON in `content.body`, beside the
// components that already say what the entry is. Each becomes the shape
// @yaks/session writes today (packages/session/README.md#the-transcript):
//
// - message: its text, by @yaks/openai's own `items()`;
// - function_call: the `call` it already carries, sourced from its ask, with
//   no body (unless its arguments never parsed) and no `output`;
// - reasoning, keepalive: gone — every reasoning item is encrypted with no
//   summary text, and today's writers write no reasoning entry without text;
// - compaction: its `checkpoint` and `output`, without the encrypted body;
// - response.failed / response.incomplete: an `error{code}` with its message.
//   Where it is the session's last entry, the harness that wrote it did
//   nothing after it, and today's daemon would retry an error on its next
//   resume: the session gets the `stop` that says the run ended, dated at the
//   failure.
//
// Every write guards the body it read (`$was`), and every touched session's
// status is read before and after: a migration that moved one anywhere but to
// `stopped` is reported.
//
//   deno run -A bin/migrate-transcripts.ts <config> [--write]

import { DatabaseSync } from 'node:sqlite'
import type { Bundle } from '@yaks/graph'
import { close, opened, signer } from '../packages/cli/local.ts'
import { read } from '../packages/cli/config.ts'
import { items } from '../packages/openai/responses.ts'
import { statusOf } from '../packages/session/status.ts'

let [path, flag] = Deno.args
let write = flag == '--write'
let db = new DatabaseSync(read(path).db!, { readOnly: true })

type Row = {
  eid: string
  session: string
  sha: string
  value: string
  source: string | null
  args: string | null
  callSource: string | null
  at: string
  last: number
}

let rows = db.prepare(`
  select e.eid, s.eid session, c.body sha, b.value, src.eid source,
         k.args, ks.eid callSource, cr.at,
         n.seq = (
           select max(m.seq) from entry m
           where m.session = n.session
             and not exists (select 1 from notice x where x.entity = m.entity)
         ) last
  from content c
  join created cr on cr.entity = c.entity
  join output x on x.entity = c.entity
  join entity e on e.id = c.entity
  join entry n on n.entity = c.entity
  join entity s on s.id = n.session
  join blob_text b on b.sha = c.body
  left join entity src on src.id = x.source
  left join call k on k.entity = c.entity
  left join entity ks on ks.id = k.source
  where b.value like '{%' and json_valid(b.value)
    and json_extract(b.value, '$.type') in ('message', 'function_call',
      'reasoning', 'keepalive', 'compaction', 'response.failed',
      'response.incomplete')
`).all() as Row[]

let str = (v: unknown) => typeof v == 'string' ? v : ''

let plan = (r: Row): Bundle => {
  let v = JSON.parse(r.value)
  let entity = { eid: r.eid }
  let $was = { content: { body: r.sha } }
  switch (v.type) {
    case 'message': {
      let [said] = items([v])
      let body = said && 'text' in said ? said.text : ''
      return { entity, $was, content: { body } }
    }
    case 'function_call':
      return {
        entity,
        $was,
        content: r.args == null ? { body: str(v.arguments) } : null,
        output: null,
        ...r.callSource == null && r.source
          ? { call: { source: r.source } }
          : {},
      }
    case 'compaction':
      return { entity, $was, content: null }
    case 'response.failed': {
      let e = v.response?.error ?? {}
      return {
        entity,
        $was,
        error: { code: str(e.code) || str(e.type) || 'failed' },
        content: { body: str(e.message) || 'The response failed' },
        output: null,
      }
    }
    case 'response.incomplete': {
      let why = str(v.response?.incomplete_details?.reason) || 'incomplete'
      return {
        entity,
        $was,
        error: { code: why },
        content: { body: `The response was incomplete: ${why}` },
        output: null,
      }
    }
    default: // reasoning, keepalive
      return { entity, $was, $delete: true }
  }
}

let host = await opened(path, false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let sessions = [...new Set(rows.map((r) => r.session))]
let statuses = async () => {
  let out = new Map<string, string>()
  for (let s of sessions) {
    out.set(s, statusOf(await g.read(`.entry.session=${s}&*`)))
  }
  return out
}

let counts: Record<string, number> = {}
for (let r of rows) {
  let t = JSON.parse(r.value).type
  counts[t] = (counts[t] ?? 0) + 1
}
console.log(`${rows.length} entries in ${sessions.length} sessions`, counts)
if (!write) {
  console.log(JSON.stringify(rows.slice(0, 3).map(plan), null, 2))
  await close(0)
  Deno.exit(0)
}

let failed = (r: Row) =>
  /^response\.(failed|incomplete)$/.test(JSON.parse(r.value).type)
let ended = rows.filter((r) => r.last && failed(r))
console.log(`${ended.length} sessions ended on a failure`)

let before = await statuses()
// The stops first: a session never reads `pending` in between, for a resume to
// wake.
for (let r of ended) {
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: r.session },
    stop: {},
    ...as,
  }], { now: r.at })
}
let bundles = rows.map((r) => ({ ...plan(r), ...as }))
for (let i = 0; i < bundles.length; i += 20) {
  await g.apply(bundles.slice(i, i + 20))
}
let after = await statuses()
let moved = sessions.filter((s) =>
  before.get(s) != after.get(s) && after.get(s) != 'stopped'
)
let stopped = sessions.filter((s) => before.get(s) != after.get(s)).length -
  moved.length
console.log(`${stopped} sessions now stopped`)
console.log(`applied ${bundles.length}; ${moved.length} sessions moved`)
for (let s of moved) console.log(`  ${s}: ${before.get(s)} -> ${after.get(s)}`)
await close(moved.length ? 1 : 0)

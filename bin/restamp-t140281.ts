// T-140281: nine rows three of session ac7184a3's MCP calls wrote as a web
// process for nobody, their PreToolUse hooks never heard: restamp them as the
// session's persona through the session.
import { compose, facet } from '@yaks/cli/host'
import type { Bundle } from '@yaks/graph'
import { read } from '../packages/cli/config.ts'

let PROCESSES = [
  '1060e899-a8fc-4d78-811b-e19a4edfc88d',
  'a9c67ce2-90a8-4a8b-aa4b-cbf8cad53586',
]
let writer = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: 'ac7184a3-f341-4697-a8a7-b4ea0984c0db',
}
let rows = [
  '3ff22aaa-25cc-48c7-86db-b54db79af6b3',
  '25ff291a-b1bd-4a3a-8476-aaacdc54556f',
  'bcb475ca-5205-8464-b59f-f32f4b03e8cd',
  '8da4863d-ceb7-4a61-adf9-6e1b44048919',
  'ddab6fc9-3161-4275-8f8a-6ea6bb24c1db',
  'b9473729-db80-8650-b0b4-b9d33fe10bda',
  '07f13b8a-99aa-4567-b578-c8d8705027cc',
  'dfbe6132-e582-4217-9d51-a631d175a1c6',
  '2fdb6796-016e-8704-b6fd-f227cd5d2206',
]
let wrong = (s: unknown) => {
  let { by, via } = (s ?? {}) as { by?: string; via?: string }
  return PROCESSES.includes(via ?? '') && !by
}
let host = await compose(
  read(`${Deno.env.get('HOME')}/.yak/yak.json`),
  ['graph'],
  facet,
  { process: false },
)
try {
  let found = await host.graph.get(rows, ['created', 'updated'])
  let patches = found.flatMap((row): Bundle[] => {
    let fix = Object.fromEntries(
      (['created', 'updated'] as const).filter((c) => wrong(row[c]))
        .map((c) => [c, writer]),
    )
    return Object.keys(fix).length ? [{ entity: row.entity, ...fix }] : []
  })
  console.log(`restamping ${patches.length} of ${rows.length} rows`)
  if (patches.length) {
    await host.graph.apply(
      patches.map((p) => ({ ...p, $actor: writer })),
      { trusted: true, stamp: false },
    )
  }
  let left = (await host.graph.get(rows, ['created', 'updated']))
    .filter((r) => wrong(r.created) || wrong(r.updated))
  console.log(`left wrong: ${left.length}`)
} finally {
  await host.close()
}

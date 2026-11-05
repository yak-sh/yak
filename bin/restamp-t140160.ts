// T-140160: nine rows two of session ac7184a3's MCP calls wrote as the web
// process for nobody, its PreToolUse hook not yet heard: restamp them as the
// session's persona through the session.
import { compose, facet } from '@yaks/cli/host'
import type { Bundle } from '@yaks/graph'
import { read } from '../packages/cli/config.ts'

let PROCESS = '99501532-4f01-4a7e-8e31-cc15dfc3305d'
let writer = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: 'ac7184a3-f341-4697-a8a7-b4ea0984c0db',
}
let rows = [
  'eb44252b-674b-4567-ba3e-68e157ae591f',
  'c2a89f5b-46e6-477f-9788-ea1106ce0c6f',
  'b22e6c45-6f9d-4ff4-bc09-78f9421150bf',
  '42bc50d1-8d65-8ae3-84c8-e69bc9d2018e',
  '8b16c5d4-2d57-4d79-ac3f-228860b6dbf7',
  '7a4d4f99-5d12-87b9-b3b0-4a7d777ca38b',
  'c5e8f053-b853-47d8-8661-c417b753a3b7',
  'fc53896d-d48b-448b-ac74-3669327c5261',
  'defa67c7-47a0-8151-a1e6-4ff215d7745c',
]
let wrong = (s: unknown) => {
  let { by, via } = (s ?? {}) as { by?: string; via?: string }
  return via == PROCESS && !by
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

// T-133328: writes the spawned Codex runs of 2026-10-29 made through MCP
// connections that named no run, stamped with no `by` and `via` the connection.
// Each is pointed at its run: `by` the actor the run works as, `via` the run.
// `--check` rolls the write back.
import { compose, facet } from '@yaks/cli/host'
import type { Bundle, Comp } from '@yaks/graph'
import { actorOf } from '@yaks/session'
import { read } from '../packages/cli/config.ts'

// Connection → the session_spawn run it served, matched by the tasks each
// touched and the session_brief each wrote for its run.
let RUNS: Record<string, string> = {
  '68c542ce-d247-46f2-91e9-57c072a2e7e2':
    '509b4579-6b42-45a4-911f-de75a063babd',
  '9e078fab-84e8-4e88-8f16-0d3db371ccd9':
    'fdbc57d1-2105-4c67-b5bf-8090698734fe',
  '3880a807-636e-4414-923e-1fbe1453f239':
    'fdbc57d1-2105-4c67-b5bf-8090698734fe',
  'e15335bc-6362-4b45-904c-e6b59c6931e8':
    '2061ca18-8316-4df7-b078-9becb81f4ab4',
}

let check = Deno.args.includes('--check')
let config = read(`${Deno.env.get('HOME')}/.yak/yak.json`)
let host = await compose(config, ['graph'], facet, { process: false })
try {
  let g = host.graph
  let patches: Bundle[] = []
  for (let [conn, run] of Object.entries(RUNS)) {
    let by = await actorOf(g, run)
    if (!by) throw new Error(`run ${run} works as nobody`)
    for (let stamp of ['created', 'updated']) {
      let rows = await g.read(`.${stamp}.via=${conn} &?${stamp}`)
      for (let b of rows) {
        let s = b[stamp] as Comp
        if (s.by) continue
        patches.push({
          entity: { eid: b.entity.eid },
          [stamp]: { by, via: run },
        })
      }
    }
  }
  console.log(`${patches.length} stamps to repair`)
  await g.apply(patches, { trusted: true, stamp: false, check })
  let left = 0
  for (let conn of Object.keys(RUNS)) {
    for (let stamp of ['created', 'updated']) {
      left += (await g.read(`.${stamp}.via=${conn} &?${stamp}`))
        .filter((b) => !(b[stamp] as Comp).by).length
    }
  }
  console.log(`${check ? 'checked' : 'repaired'}; ${left} left unstamped`)
} finally {
  await host.close()
}

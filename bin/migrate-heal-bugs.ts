// T-121638 / D-121624: retire the box's bug components, keeping tasks and
// fixer history. Run after a backup; review --check first, then delete this script.
//
// deno run -A bin/migrate-heal-bugs.ts --config /absolute/yak.json \
//   --tracker-db /absolute/tracker.db [--check]
//
// Only vocabulary is loaded: no services, effects, host or schema installer.
// Tracker reads use sqlite3 -readonly; all box writes use one graph batch.
// The empty bug table is left in place; no DDL runs here.
import { archetypes } from '@yaks/archetype'
import { edges, link } from '@yaks/edge'
import {
  type Bundle,
  type Comp,
  derivedEid,
  type Graph,
  graph,
  token,
} from '@yaks/graph'
import { journal, log } from '@yaks/journal'
import { fn, select, star, table } from '@yaks/sql'
import { objects, storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { read } from '../packages/cli/config.ts'
import { words } from '../packages/cli/words.ts'

let comp = (row: Bundle, name: string): Comp => row[name] as Comp ?? {}
let assert = (holds: unknown, message: string): void => {
  if (!holds) throw new Error(message)
}
export type TrackerBug = { eid: string; fault: string; app: string | null }

/** Stored faults are already faultKey output. Grouping compares them exactly,
 * within app scope; normalizing again would change the key's separators. */
export let moveBugs = async (
  g: Graph,
  tracker: TrackerBug[],
  check = false,
) => {
  let bugs = g.vocab.comp('bug') ? await g.read('.bug *') : []
  let fixers = await g.read('.fixer *')
  let failed = await g.read(
    '.effect.handler=exception_file .effect.state=failed',
  )
  let groups = new Map<string, string>()
  for (let bug of tracker.filter((b) => !b.app)) {
    assert(!groups.has(bug.fault), `Duplicate box tracker fault: ${bug.fault}`)
    groups.set(bug.fault, bug.eid)
  }
  let matched = new Map<string, string>()
  let patches: Bundle[] = []
  for (let row of bugs) {
    assert(row.task, `Legacy bug is not a task: ${row.entity.eid}`)
    let bug = comp(row, 'bug')
    let twin = groups.get(String(bug.fault ?? ''))
    patches.push({
      entity: { eid: row.entity.eid },
      $was: {
        bug: Object.fromEntries(
          Object.entries(bug).map(([p, v]) => [p, token(v)]),
        ),
      },
      bug: null,
    })
    if (twin) {
      matched.set(row.entity.eid, twin)
      patches.push(link(row.entity.eid, 'about', twin))
    }
  }
  let rewritten = 0
  for (let row of fixers) {
    let prior = comp(row, 'fixer').bug
    let twin = matched.get(String(prior))
    if (!twin) continue
    rewritten++
    patches.push({
      entity: { eid: row.entity.eid },
      $was: { fixer: { bug: token(prior) } },
      fixer: { bug: twin },
    })
  }
  patches.push(...failed.map((row): Bundle => ({
    entity: { eid: row.entity.eid },
    $was: {
      effect: { handler: token('exception_file'), state: token('failed') },
    },
    $delete: true,
  })))
  if (patches.length) await g.apply(patches, { trusted: true, check })

  // The graph's read path proves presence pointers as well as stored values.
  assert(
    !g.vocab.comp('bug') ||
      (await g.read('.bug')).length == (check ? bugs.length : 0),
    'Bug count differs',
  )
  assert(
    (await g.read('.fixer')).length == fixers.length,
    'Fixer count changed',
  )
  for (let prior of [...bugs, ...fixers]) {
    let [now] = await g.get([prior.entity.eid])
    assert(now, `History entity disappeared: ${prior.entity.eid}`)
    assert(now.entity.num == prior.entity.num, 'Task/session number changed')
    for (let [name, value] of Object.entries(prior)) {
      if (['entity', 'bug', 'updated'].includes(name)) continue
      let expected = !check && name == 'fixer' &&
          matched.has(String(comp(prior, 'fixer').bug))
        ? {
          ...value as Comp,
          bug: matched.get(String(comp(prior, 'fixer').bug)),
        }
        : value
      assert(
        JSON.stringify(now[name]) == JSON.stringify(expected),
        `History changed: ${prior.entity.eid}.${name}`,
      )
    }
  }
  if (!check) {
    for (let [task, bug] of matched) {
      let [edge] = await g.get([link(task, 'about', bug).entity.eid])
      assert(
        edge?.about && comp(edge, 'edge').from == task &&
          comp(edge, 'edge').to == bug,
        'About edge missing',
      )
    }
    assert(
      !(await g.read('.effect.handler=exception_file .effect.state=failed'))
        .length,
      'Obsolete failed runs remain',
    )
  }
  let sample = bugs.slice(0, 3).map((row) => ({
    eid: row.entity.eid,
    num: row.entity.num,
    title: comp(row, 'doc').title,
    trackerBug: matched.get(row.entity.eid) ?? null,
    fault: String(comp(row, 'bug').fault).slice(0, 160),
  }))
  return {
    check,
    bugs: bugs.length,
    trackerBugs: tracker.length,
    matched: matched.size,
    unmatched: bugs.length - matched.size,
    unmatchedOpen:
      bugs.filter((r) =>
        !matched.has(r.entity.eid) && !r.completed && !r.cancelled
      ).length,
    fixers: fixers.length,
    rewritten,
    failedRunsDropped: failed.length,
    patches: patches.length,
    sample,
  }
}

let run = async () => {
  let configPath: string | undefined
  let trackerPath: string | undefined
  let check = false
  for (let i = 0; i < Deno.args.length; i++) {
    let arg = Deno.args[i]
    if (arg == '--check') check = true
    else if (arg == '--config' || arg == '--tracker-db') {
      let value = Deno.args[++i]
      assert(value && !value.startsWith('--'), `Missing value for ${arg}`)
      if (arg == '--config') configPath = value
      else trackerPath = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  assert(
    configPath && trackerPath,
    'Explicit --config and --tracker-db required',
  )
  let config = read(configPath!)
  assert(
    config.db && config.db != ':memory:',
    'Config must name an existing box database',
  )
  let boxPath = await Deno.realPath(config.db!)
  let trackerDb = await Deno.realPath(trackerPath!)
  assert(boxPath != trackerDb, 'Box and tracker must be different stores')
  let result = await new Deno.Command('sqlite3', {
    args: [
      '-readonly',
      '-json',
      trackerDb,
      'select e.eid, b.fault, a.eid as app from bug b join entity e on e.id=b.entity left join entity a on a.id=b.app',
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  assert(
    result.success,
    `Tracker read failed: ${new TextDecoder().decode(result.stderr)}`,
  )
  let tracker: TrackerBug[] = JSON.parse(
    new TextDecoder().decode(result.stdout) || '[]',
  )
  let loaded = await words(config)
  let declared = loaded.docs.filter((d) => d.$defs?.bug?.component).map((d) =>
    d.package ?? d.title
  )
  // Temporary admission for the old shape, without loading tracker into the box.
  let legacy: VocabDoc = {
    $defs: {
      bug: {
        component: true,
        type: 'object',
        properties: {
          fault: { type: 'string' },
          hits: { type: 'number' },
          last: { type: 'string' },
        },
      },
    },
  }
  let db = open(boxPath)
  try {
    let tables = new Set(
      objects(db).filter((r) => r.type == 'table').map((r) => r.name),
    )
    let vocab = tables.has('bug') && !loaded.vocab.comp('bug')
      ? loadVocab([...loaded.docs, legacy], loaded.vocab.keywords)
      : loaded.vocab
    let store = storage(db, vocab, {
      derived: loaded.derived,
      backed: loaded.backed,
      number: config.numbers,
      schemaReady: () => true,
    })
    let g = graph({
      storage: store,
      vocab,
      actor: { by: derivedEid('migration|T-121638') },
      plugins: [
        archetypes(),
        edges(vocab),
        journal(
          log({ rows: (s) => db.query(s), derived: loaded.derived }),
          vocab,
        ),
      ],
    })
    let counts = () =>
      Object.fromEntries(
        [
          'bug',
          'task',
          'fixer',
          'about',
          'effect',
          'journal_tx',
          'journal_change',
        ].map((name) => [
          name,
          tables.has(name)
            ? Number(
              db.query(
                select({ cols: [fn('count', star())], from: table(name) }),
              )[0]['count(*)'],
            )
            : 0,
        ]),
      )
    let before = counts()
    let moved = await moveBugs(g, tracker, check)
    let after = counts()
    assert(
      before.task == after.task && before.fixer == after.fixer,
      'Task or fixer count changed',
    )
    if (check) {
      assert(
        JSON.stringify(before) == JSON.stringify(after),
        'Check changed row counts',
      )
    }
    console.log(
      JSON.stringify(
        {
          ...moved,
          before,
          after,
          bugDeclaredBy: declared,
          bugTableUnneeded: after.bug == 0 && !declared.length,
        },
        null,
        2,
      ),
    )
  } finally {
    db.close()
  }
}
if (import.meta.main) await run()

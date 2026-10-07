/** The box bench: where time goes when the fleet uses the graph, measured
 * against a copy of a box's graph and its config. One command runs it:
 *
 *   deno task bench box -- --config ~/.cache/yak-bench/yak.json \
 *     --base ~/.cache/yak-bench/base.db
 *
 * It measures, each round, the `yak` commands agents run (wall and CPU, from
 * spawn to exit), the phases of one command timed from inside
 * (./box-probe.ts), the rows a read and a write add, and in a child process
 * `apply()` and the effect pool (./box-graph.ts); and once, after the rounds,
 * what the database holds. Every child runs this checkout's code without
 * network permission. The copy's database is written to: `--base` copies a
 * snapshot over it first, so every run starts from the same bytes.
 *
 * Flags: `--config` (required), `--base`, `--rounds` (3), `--runs` (7 timed
 * runs of each command a round), `--show` (the entity `graph show` reads,
 * T-65275), `--only` (comma-separated sections: cli, startup, rows, graph,
 * and db, which is left out unless named: it reads every page of the file).
 * Results go to bench/box.results.json (and box-db.results.json); a baseline,
 * once accepted with `bench:ratchet box`, to bench/box.baseline.json. */
import {
  type CollectedSuite,
  type Options,
  type Run,
  run,
  type Sample,
} from '@yaks/benchmark'
import { derivedEid } from '@yaks/graph'
import { read } from '@yaks/cli'
import {
  charge,
  childEnv,
  GRAPH,
  PERMS,
  quantile,
  split,
  statements,
} from './box-lib.ts'
import type { Event } from '@yaks/trace'

let ROOT = new URL('..', import.meta.url).pathname
let DENO = `${ROOT}deno.json`
let YAK = `${ROOT}packages/cli/yak.ts`
/** The entity the bench's comments are written on: its own, so no task the
 * commands read gains any. */
let TARGET = derivedEid('@yaks/bench box target')

type Flags = {
  config: string
  base?: string
  rounds: number
  runs: number
  show: string
  only: string[]
}
let SECTIONS = ['cli', 'startup', 'rows', 'graph', 'db']

/** The commands timed end to end, by name: what an agent types. */
let commands = (f: Flags): [string, string[]][] => [
  ['help', ['help']],
  ['task list', ['task', 'list']],
  ['graph show', ['graph', 'show', f.show]],
  ['query .project', ['graph', 'query', '.project']],
  ['query .session.status=running', [
    'graph',
    'query',
    '.session.status=running',
  ]],
  ['query .task .count', ['graph', 'query', '.task .count']],
  ['comment new', ['comment', 'new', TARGET, 'box bench comment']],
  ['graph apply 1', ['graph', 'apply', '--bundles', '@BUNDLES1']],
  ['graph apply 100', ['graph', 'apply', '--bundles', '@BUNDLES100']],
]
/** The commands whose phases are timed from inside. */
let PROBED: [string, string[]][] = [
  ['help', ['help']],
  ['read', ['graph', 'query', '.task .count']],
  ['write', ['comment', 'new', TARGET, 'box bench comment']],
]
let PHASES = ['boot', 'import', 'commands', 'compose', 'tool', 'close', 'exit']
let ROWS: [string, string[]][] = [
  ['task list', ['task', 'list']],
  ['comment new', ['comment', 'new', TARGET, 'box bench comment']],
]
let TABLES = ['entity', 'journal_change', 'effect']

let names = (f: Flags): Record<string, string[]> => ({
  cli: ['deno', ...commands(f).map(([n]) => n)].map((n) => `cli/${n}`),
  startup: [
    ...PROBED.flatMap(([n]) =>
      [...PHASES, 'total'].map((p) => `startup/${n}/${p}`)
    ),
    ...PROBED.filter(([n]) => n != 'help').map(([n]) => `compose/${n}`),
  ],
  rows: ROWS.flatMap(([n]) => TABLES.map((t) => `rows/${n}/${t}`)),
  graph: GRAPH,
})
let unit = (name: string) => name.startsWith('rows/') ? 'rows' : 'ms'

export let main = async (action: string, args: string[]): Promise<number> => {
  let f = flags(args)
  let config = read(f.config)
  let db = config.db!
  await refuse(db)
  if (f.base) await reset(f.base, db)
  let scratch = await Deno.makeTempDir({ prefix: 'box-bench-' })
  try {
    let bundles = async (n: number) => {
      let path = `${scratch}/bundles-${n}.json`
      await Deno.writeTextFile(
        path,
        JSON.stringify(
          Array.from({ length: n }, (_, i) => ({
            entity: { eid: `$c${i}` },
            doc: { body: `box bench comment ${i}` },
            comment: { target: TARGET },
          })),
        ),
      )
      return path
    }
    let files: Record<string, string> = {
      '@BUNDLES1': '@' + await bundles(1),
      '@BUNDLES100': '@' + await bundles(100),
    }
    let yak = (argv: string[]) =>
      timed([
        YAK,
        '--config',
        f.config,
        ...argv.map((a) => files[a] ?? a),
      ])
    // The comments' target, written once through the command line.
    await yak([
      'graph',
      'apply',
      '--bundles',
      JSON.stringify([{
        entity: { eid: TARGET },
        doc: { title: 'box bench' },
      }]),
    ])
    let sections = f.only.filter((s) => s != 'db')
    let wanted = sections.flatMap((s) => names(f)[s] ?? [])
    let suite: CollectedSuite = {
      name: 'box',
      metric: 'median-of-round-medians',
      workload: JSON.stringify([1, f.base ?? 'unpinned', f.show]),
      benches: wanted.map((name) => ({ name, unit: unit(name) })),
      collect: async (round) => {
        let got: Record<string, Sample[]> = {}
        let add = (name: string, s: Sample) => (got[name] ??= []).push(s)
        if (sections.includes('cli')) {
          let list: [string, string[] | null][] = [
            ['deno', null],
            ...commands(f),
          ]
          let once = (argv: string[] | null) =>
            argv ? yak(argv) : timed([`${ROOT}bench/box-lib.ts`])
          for (let [, argv] of list) await once(argv)
          for (let i = 0; i < f.runs; i++) {
            for (let [name, argv] of list) {
              let t = await once(argv)
              add(`cli/${name}`, {
                value: t.ms,
                counts: { cpu: t.cpu, inputs: t.inputs },
              })
            }
          }
        }
        if (sections.includes('startup')) {
          for (let i = 0; i < 2; i++) {
            for (let [name, argv] of PROBED) {
              let p = await probe('phases', f.config, argv)
              for (let [phase, ms] of Object.entries(p.phases)) {
                add(`startup/${name}/${phase}`, {
                  value: ms,
                  ...(phase == 'tool' || phase == 'close'
                    ? { details: p[phase] }
                    : {}),
                })
              }
              if (name == 'help') continue
              let c = await probe('compose', f.config, argv)
              add(`compose/${name}`, { value: c.compose, details: c.parts })
            }
          }
        }
        if (sections.includes('rows')) {
          for (let [name, argv] of ROWS) {
            let before = await sqlite(
              db,
              'SELECT max(id) FROM entity; SELECT max(id) FROM journal_change;',
            )
            await yak(argv)
            let [entity, change] = before.map((r) => Number(r[0]))
            let after = await sqlite(
              db,
              `SELECT count(*) FROM entity WHERE id > ${entity};
               SELECT count(*) FROM journal_change WHERE id > ${change};
               SELECT count(*) FROM effect WHERE entity > ${entity};
               SELECT trim(coalesce(a.tables, '[]') || ' ' || coalesce(f.handler, '')),
                 count(*) FROM entity e
                 LEFT JOIN archetype a ON a.entity = e.archetype
                 LEFT JOIN effect f ON f.entity = e.id
                 WHERE e.id > ${entity} GROUP BY 1 ORDER BY 1;`,
            )
            let made = Object.fromEntries(
              after.slice(3).map((r) => [r[0], Number(r[1])]),
            )
            TABLES.forEach((table, i) =>
              add(`rows/${name}/${table}`, {
                value: Number(after[i][0]),
                ...(table == 'entity' ? { details: made } : {}),
              })
            )
          }
        }
        if (sections.includes('graph')) {
          let out = `${scratch}/graph-${round}.json`
          await timed([`${ROOT}bench/box-graph.ts`, f.config, TARGET, out])
          let measured = JSON.parse(await Deno.readTextFile(out))
          for (let name of GRAPH) got[name] = measured[name]
        }
        return got
      },
    }
    let result: Run | undefined
    if (wanted.length) {
      let mode = action == 'ratchet' ? 'accept' : action
      result = await run(suite, {
        mode: mode as Options['mode'],
        rounds: f.rounds,
        output: `${ROOT}bench/box.results.json`,
        baseline: `${ROOT}bench/box.baseline.json`,
        tolerance: mode == 'accept' ? .25 : undefined,
        coverage: sections.length == SECTIONS.length - 1 ? 'exact' : 'subset',
        lock: '/tmp/yaks-throughput-bench.lock',
      })
    }
    let held = f.only.includes('db') ? await holds(db) : undefined
    if (held) {
      await Deno.writeTextFile(
        `${ROOT}bench/box-db.results.json`,
        JSON.stringify(held, null, 2) + '\n',
      )
    }
    console.log(table(db, result, held))
    return 0
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}

let flags = (args: string[]): Flags => {
  let said: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    let [key, value] = args[i].split(/=(.*)/s)
    if (!key.startsWith('--')) throw new Error(`box: unexpected ${args[i]}`)
    said[key.slice(2)] = value ?? args[++i]
  }
  if (!said.config) throw new Error('box: --config <path> is required')
  let only = said.only ? said.only.split(',') : SECTIONS.slice(0, -1)
  for (let s of only) {
    if (!SECTIONS.includes(s)) throw new Error(`box: no section ${s}`)
  }
  return {
    config: absolute(said.config),
    base: said.base ? absolute(said.base) : undefined,
    rounds: Number(said.rounds ?? 3),
    runs: Number(said.runs ?? 7),
    show: said.show ?? 'T-65275',
    only,
  }
}
let absolute = (path: string) =>
  path.startsWith('/') ? path : `${Deno.cwd()}/${path}`

/** The live graph is somebody's working memory: the bench writes, so it
 * runs only against a copy, never a database under ~/.yak. */
let refuse = async (db: string) => {
  let home = Deno.env.get('HOME')
  let real = await Deno.realPath(db).catch(() => db)
  if (db == ':memory:' || (home && real.startsWith(`${home}/.yak/`))) {
    throw new Error(`box: ${db} is a live graph; point --config at a copy`)
  }
}

/** The copy, made the snapshot's bytes again: its write-ahead log and
 * shared memory go with the old file. */
let reset = async (base: string, db: string) => {
  let start = performance.now()
  for (let suffix of ['-wal', '-shm']) {
    await Deno.remove(db + suffix).catch(() => {})
  }
  await Deno.copyFile(base, db)
  await Deno.chmod(db, 0o644)
  console.error(
    `box: ${db} reset from ${base} in ${
      ((performance.now() - start) / 1000).toFixed(0)
    } s`,
  )
}

type Timed = { ms: number; cpu: number; inputs: number; stdout: string }
let TIME = '/usr/bin/time'

/** One child, from spawn to exit: its wall time, and the CPU and file-system
 * input its kernel accounts for. */
let timed = async (
  argv: string[],
  env: Record<string, string> = {},
): Promise<Timed & { start: number; end: number }> => {
  let usage = await Deno.makeTempFile()
  try {
    let start = performance.timeOrigin + performance.now()
    let child = await new Deno.Command(TIME, {
      args: [
        '-f',
        '%U %S %I',
        '-o',
        usage,
        Deno.execPath(),
        'run',
        ...PERMS,
        '--config',
        DENO,
        ...argv,
      ],
      env: childEnv(env),
      clearEnv: true,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    let end = performance.timeOrigin + performance.now()
    let text = new TextDecoder()
    if (!child.success) {
      throw new Error(
        `box: ${argv.join(' ')} exited ${child.code}\n${
          text.decode(child.stderr)
        }`,
      )
    }
    let [user, system, inputs] = (await Deno.readTextFile(usage)).trim()
      .split('\n').at(-1)!.split(' ').map(Number)
    return {
      ms: end - start,
      cpu: (user + system) * 1000,
      inputs,
      stdout: text.decode(child.stdout),
      start,
      end,
    }
  } finally {
    await Deno.remove(usage)
  }
}

type Probe = { origin: number; marks: Record<string, number>; waste: number }
let probe = async (mode: string, config: string, argv: string[]) => {
  let out = await Deno.makeTempFile()
  try {
    let t = await timed(
      [`${ROOT}bench/box-probe.ts`, mode, '--config', config, ...argv],
      { BOX_PROBE_OUT: out },
    )
    let p: Probe & { spans: Event[] } = JSON.parse(
      await Deno.readTextFile(out),
    )
    let m = p.marks
    let at = (name: string) => p.origin + m[name]
    let opened = m.compose ?? m.commands
    let ran = m.tool ?? m.cli
    let phases: Record<string, number> = {
      boot: at('boot') - t.start,
      import: m.import - m.boot,
      commands: m.commands - m.import,
      compose: m.compose ? m.compose - m.commands - p.waste : 0,
      tool: ran - opened - (m.compose ? 0 : p.waste),
      close: m.close - ran,
      exit: t.end - at('close'),
      total: t.end - t.start,
    }
    // What the graph did, by the phase it did it in: a span belongs to the
    // phase its start falls in.
    let within = (from: number, to: number) => {
      let spans = p.spans.filter((s) => {
        let start = s.start ?? s.time
        return start >= from && start <= to
      })
      let ids = new Set(spans.map((s) => s.id))
      return {
        roots: spans.filter((s) => !s.parent || !ids.has(s.parent))
          .map((s) => `${s.kind} ${s.name} ${(s.duration ?? 0).toFixed(1)}`),
        split: rounded(split(spans, charge)),
        sql: heaviest(spans),
      }
    }
    let composed = p.spans.find((s) => s.kind == 'process-start')
    return {
      phases,
      tool: within(opened, ran),
      close: within(m.cli, m.close),
      compose: composed?.duration ?? 0,
      parts: {
        ...Object.fromEntries(
          p.spans.filter((s) => s.parent == composed?.id && s.kind == 'phase')
            .map((s) => [
              s.name.replace('@yaks/cli.compose.', ''),
              +(s.duration ?? 0).toFixed(3),
            ]),
        ),
        sql: heaviest(p.spans),
      },
    }
  } finally {
    await Deno.remove(out)
  }
}

/** Rows of a read-only query on the copy, by the sqlite3 shell. */
let sqlite = async (db: string, sql: string): Promise<string[][]> => {
  let out = await new Deno.Command('sqlite3', {
    args: ['-readonly', '-list', '-separator', '\t', db, sql],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  return new TextDecoder().decode(out.stdout).trim().split('\n')
    .filter(Boolean).map((line) => line.split('\t'))
}

/** What the database holds: its size by table, its entities by archetype,
 * its effect runs by state, and how many journal changes each of the last
 * seven days wrote. Read once, after the rounds: it reads every page. */
let holds = async (db: string) => {
  let size = (await Deno.stat(db)).size
  let tables = await sqlite(
    db,
    `SELECT name, sum(pgsize) FROM dbstat WHERE aggregate = TRUE
     GROUP BY name ORDER BY 2 DESC`,
  )
  let archetypes = await sqlite(
    db,
    `SELECT coalesce(a.tables, '(none)'), n FROM
       (SELECT archetype, count(*) n FROM entity GROUP BY archetype
        ORDER BY n DESC LIMIT 20) c
     LEFT JOIN archetype a ON a.entity = c.archetype ORDER BY n DESC`,
  )
  let effects = await sqlite(
    db,
    `SELECT state, handler, count(*) FROM effect GROUP BY 1, 2
     ORDER BY 3 DESC LIMIT 20`,
  )
  // journal_tx ids grow with time, so a day's changes are the ones whose
  // transaction lies between that day's first id and the next's.
  let [[last]] = await sqlite(db, 'SELECT max(id) FROM journal_tx')
  let found = new Map<string, number>()
  let first = async (day: string) => {
    if (found.has(day)) return found.get(day)!
    let lo = 1, hi = Number(last) + 1
    while (lo < hi) {
      let mid = Math.floor((lo + hi) / 2)
      let [[ts]] = await sqlite(
        db,
        `SELECT coalesce((SELECT ts FROM journal_tx WHERE id >= ${mid}
          ORDER BY id LIMIT 1), '9')`,
      )
      if (ts < day) lo = mid + 1
      else hi = mid
    }
    found.set(day, lo)
    return lo
  }
  let today = new Date()
  let days: [string, number][] = []
  for (let back = 7; back >= 1; back--) {
    let day = new Date(today.getTime() - back * 86_400_000).toISOString()
      .slice(0, 10)
    let next = new Date(today.getTime() - (back - 1) * 86_400_000)
      .toISOString().slice(0, 10)
    let [a, b] = [await first(day), await first(next)]
    let [[n]] = await sqlite(
      db,
      `SELECT count(*) FROM journal_change WHERE tx >= ${a} AND tx < ${b}`,
    )
    days.push([day, Number(n)])
  }
  return {
    size,
    tables: tables.map(([name, bytes]) => [name, Number(bytes)]),
    archetypes: archetypes.map(([kind, n]) => [kind, Number(n)]),
    effects: effects.map(([state, handler, n]) => [
      `${state} ${handler}`,
      Number(n),
    ]),
    days,
  }
}

/** The statements that took longest, with how many ran. */
let heaviest = (spans: Event[]) =>
  Object.fromEntries(
    Object.entries(statements(spans)).sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 8).map(([k, v]) => [k, `${v.n} × ${v.ms.toFixed(1)} ms`]),
  )

let rounded = (by: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(by).sort((a, b) => b[1] - a[1]).map((
      [k, v],
    ) => [k, +v.toFixed(3)]),
  )

let pad = (s: string | number, n: number) =>
  String(s).length >= n ? String(s) : String(s).padStart(n)
let num = (n: number) =>
  n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
let mb = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`

/** Where the median sample's time went, where it says: its three largest
 * shares (of a `split`, or of compose()'s phases). */
let where = (samples: Run['benches'][number]['samples']) => {
  let middle = [...samples].sort((a, b) => a.value - b.value)[
    Math.floor(samples.length / 2)
  ]
  let details = middle?.details as
    | { split?: Record<string, number> }
    | Record<string, unknown>
    | undefined
  let by = (details?.split ?? details) as Record<string, unknown> | undefined
  if (!by || typeof by != 'object') return ''
  let parts = Object.entries(by).filter((e): e is [string, number] =>
    typeof e[1] == 'number'
  )
  let total = parts.reduce((sum, [, ms]) => sum + ms, 0)
  if (!total || parts.length < 2) return ''
  return parts.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, ms]) =>
    `${k} ${(ms * 100 / total).toFixed(0)}%`
  ).join(', ')
}

/** The run as one compact table: each bench's sample count, median and 95th
 * percentile, and what else its samples counted. */
export let table = (
  db: string,
  result?: Run,
  held?: Awaited<ReturnType<typeof holds>>,
): string => {
  let lines: string[] = []
  if (result) {
    lines.push(
      `box bench — ${db} — ${result.commit?.slice(0, 9) ?? '?'} — load ${
        result.load.join(' ')
      } — ${result.rounds} rounds`,
      '',
      `${'bench'.padEnd(42)}${pad('n', 4)}${pad('p50', 9)}${
        pad('p95', 9)
      }  unit  notes`,
    )
    for (let b of result.benches) {
      let values = b.samples.map((s) => s.value)
      let note = ''
      let cpu = b.samples.map((s) => s.counts?.cpu).filter((n) =>
        n != null
      ) as number[]
      if (cpu.length) note = `cpu p50 ${num(quantile(cpu, .5))} ms`
      let bundles = b.samples[0]?.counts?.bundles
      if (bundles) {
        note = `${num(quantile(values, .5) * 1000 / bundles)} µs/bundle`
      }
      let pending = b.samples[0]?.counts?.pending
      if (pending != null && b.name.startsWith('pool/due')) {
        note = `${pending} pending`
      }
      if (b.name == 'pool/drain') {
        note = `${b.samples.map((s) => s.counts?.runs).join('+')} runs`
      }
      let shares = b.unit == 'ms' ? where(b.samples) : ''
      if (shares) note = [note, shares].filter(Boolean).join(' · ')
      lines.push(
        `${b.name.padEnd(42)}${pad(values.length, 4)}${
          pad(num(quantile(values, .5)), 9)
        }${pad(num(quantile(values, .95)), 9)}  ${b.unit.padEnd(5)} ${note}`,
      )
    }
  }
  if (held) {
    lines.push('', `database ${mb(held.size)}`, '')
    for (let [name, bytes] of held.tables.slice(0, 15)) {
      lines.push(`  ${String(name).padEnd(40)}${pad(mb(Number(bytes)), 10)}`)
    }
    lines.push('', 'entities by archetype', '')
    for (let [kind, n] of held.archetypes) {
      lines.push(`  ${String(kind).slice(0, 60).padEnd(62)}${pad(n, 9)}`)
    }
    lines.push('', 'effect rows', '')
    for (let [kind, n] of held.effects.slice(0, 10)) {
      lines.push(`  ${String(kind).padEnd(40)}${pad(n, 9)}`)
    }
    lines.push('', 'journal changes a day', '')
    for (let [day, n] of held.days) lines.push(`  ${day}${pad(n, 12)}`)
  }
  return lines.join('\n')
}

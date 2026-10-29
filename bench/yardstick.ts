/** SQLite-only baseline. Parse to a file spool first; replay it in fresh processes.
 * deno run -A bench/yardstick.ts parse <repo> <spool>
 * deno run -A bench/yardstick.ts run <spool> <db> <result.json>
 * deno run -A bench/yardstick.ts coarse <spool> <db> <result.json> file|declaration
 * deno run -A bench/yardstick.ts restart <db> <file> <expected count>
 */
import { stopwatch } from '@yaks/benchmark'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import {
  edit,
  emit,
  type FileTree,
  functionLiteral,
  init,
  pack,
  type Packed,
} from './yardstick-tree.ts'
import { createHash } from 'node:crypto'
import {
  and,
  as,
  call,
  col,
  cross,
  eq,
  type Expr,
  fn,
  join,
  lit,
  notNull,
  op,
  type Select,
  select,
  table,
  val,
} from '@yaks/sql'

let definitions: VocabDoc['$defs'] = {
  node: {
    component: true,
    type: 'object',
    index: [['file', 'start', 'end'], ['parent', 'ordinal']],
    properties: {
      file: { type: 'string' },
      parent: { type: 'string', ref: 'entity', death: 'keep' },
      ordinal: { type: 'number' },
      kind: { type: 'string' },
      start: { type: 'number' },
      end: { type: 'number' },
    },
  },
  reference: {
    component: true,
    type: 'object',
    index: [['source'], ['target']],
    properties: {
      source: { type: 'string', ref: 'entity', death: 'keep' },
      target: { type: 'string', ref: 'entity', death: 'keep' },
    },
  },
}
// Include normal graph stamping, rather than bypassing graph admission/rules.
for (let name of ['created', 'updated']) {
  definitions[name] = {
    component: true,
    type: 'object',
    properties: {
      at: { type: 'string', stamped: true },
      by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
    },
  }
}
let vocab = loadVocab({ $defs: definitions })
let coarseVocab = loadVocab({
  $defs: {
    ...definitions,
    tree: {
      component: true,
      index: [['file']],
      type: 'object',
      properties: {
        file: { type: 'string' },
        start: { type: 'number' },
        value: { type: 'object' },
      },
    },
  },
})
let decoder = new TextDecoder()
async function command(cmd: string, args: string[], cwd?: string) {
  let r = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!r.success) throw new Error(decoder.decode(r.stderr))
  return decoder.decode(r.stdout).trim()
}
async function environment() {
  return {
    at: new Date().toISOString(),
    timing: 'cpu',
    timeUnit: 'ms',
    uptime: await command('uptime', []),
    cpu: await Deno.readTextFile('/proc/cpuinfo').then((s) =>
      s.match(/model name\s*:\s*(.*)/)?.[1]
    ),
    memory: await Deno.readTextFile('/proc/meminfo'),
    deno: Deno.version,
    os: await command('uname', ['-a']),
  }
}
function connect(path: string, coarse = false) {
  let schema = coarse ? coarseVocab : vocab
  let driver = open(path)
  let store = storage(driver, schema)
  store.install()
  let g = graph({ storage: store, vocab: schema })
  return { driver, g }
}
function summary(samples: number[]) {
  let sorted = samples.toSorted((a, b) => a - b)
  return {
    p50: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.ceil(sorted.length * .95) - 1],
    samples: samples.map((cpu) => ({ cpu })),
    unit: 'ms',
    timing: 'cpu',
  }
}
function timedRead(read: () => unknown, n = 21) {
  let start = stopwatch()
  let first = read()
  let firstMs = start().cpu
  let samples = []
  for (let i = 0; i < n; i++) {
    start = stopwatch()
    read()
    samples.push(start().cpu)
  }
  return {
    firstMs,
    warmMs: summary(samples),
    outputBytes: JSON.stringify(first).length,
    rows: (first as unknown[]).length,
  }
}
function ordered(g: ReturnType<typeof graph>, file: string) {
  let rows = g.read(
    `.node.file=${file}&.order=node.start&.limit=1000000`,
  ) as Bundle[]
  let children = new Map<string | null, Bundle[]>()
  for (let row of rows) {
    let n = row.node as { parent: string | null }
    let group = children.get(n.parent) ?? []
    group.push(row)
    children.set(n.parent, group)
  }
  for (let group of children.values()) {
    group.sort((a, b) =>
      (a.node as { ordinal: number }).ordinal -
      (b.node as { ordinal: number }).ordinal
    )
  }
  let ordered: Bundle[] = []
  let stack = [...(children.get(null) ?? [])].reverse()
  while (stack.length) {
    let row = stack.pop()!
    ordered.push(row)
    stack.push(...(children.get(row.entity.eid) ?? []).toReversed())
  }
  if (ordered.length != rows.length) throw new Error('unreachable subtree')
  return ordered
}
async function parse(repo: string, spool: string) {
  await Deno.mkdir(spool, { recursive: true })
  let env = await environment()
  let sha = await command('git', ['rev-parse', 'HEAD'], repo)
  let files = (await command('git', ['ls-files', '-z'], repo)).split('\0')
    .filter((p) => /\.(ts|tsx|js)$/.test(p)).sort()
  let start = stopwatch()
  await init()
  let initMs = start().cpu
  let parseMs = 0
  let spoolMs = 0
  let bytes = 0
  let nodes = 0
  let references = 0
  let errors = 0
  let peakRss = Deno.memoryUsage().rss
  let hash = createHash('sha256')
  let manifest: {
    file: string
    nodes: number
    references: number
    bytes: number
    numeric: boolean
  }[] = []
  for (let [i, file] of files.entries()) {
    let source = await Deno.readTextFile(`${repo}/${file}`)
    let input = new TextEncoder().encode(source)
    hash.update(file + '\0').update(input)
    bytes += input.length
    start = stopwatch()
    let tree = emit(file, source)
    parseMs += start().cpu
    nodes += tree.nodes.length
    references += tree.references.length
    errors += tree.errors
    manifest.push({
      file,
      nodes: tree.nodes.length,
      references: tree.references.length,
      bytes: input.length,
      numeric: tree.nodes.some((n) => n.node.kind == 'number'),
    })
    start = stopwatch()
    await Deno.writeTextFile(`${spool}/${i}.json`, JSON.stringify(tree))
    await Deno.writeTextFile(`${spool}/${i}.source`, source)
    spoolMs += start().cpu
    peakRss = Math.max(peakRss, Deno.memoryUsage().rss)
    if (i % 200 == 0) {
      console.error(`parse ${i}/${files.length}, ${nodes} nodes`)
    }
  }
  let report = {
    env,
    sha,
    corpusHash: hash.digest('hex'),
    files: manifest,
    bytes,
    nodes,
    references,
    errors,
    initMs,
    parseEmitResolveMs: parseMs,
    spoolMs,
    peakRss,
    endEnvironment: await environment(),
  }
  await Deno.writeTextFile(
    `${spool}/manifest.json`,
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify({ ...report, files: files.length }))
}
async function run(spool: string, db: string, out: string) {
  try {
    await Deno.stat(db)
    throw new Error(`load requires a fresh database: ${db}`)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  let manifest = JSON.parse(await Deno.readTextFile(`${spool}/manifest.json`))
  let env = await environment()
  let start = stopwatch()
  let { driver, g } = connect(db)
  let openMs = start().cpu
  let pragmas = ['journal_mode', 'synchronous', 'page_size', 'cache_size'].map((
    name,
  ) => ({ name, value: driver.query({ t: 'pragma', name }) }))
  let applyMs = 0
  let spoolReadMs = 0
  let peakRss = Deno.memoryUsage().rss
  let batchTimes: number[] = []
  // All parent targets in a preorder batch already exist or are in that batch.
  // Reference edges follow nodes; JS never retains the whole corpus.
  for (let i = 0; i < manifest.files.length; i++) {
    start = stopwatch()
    let tree: FileTree = JSON.parse(
      await Deno.readTextFile(`${spool}/${i}.json`),
    )
    spoolReadMs += start().cpu
    for (let rows of [tree.nodes, tree.references]) {
      for (let j = 0; j < rows.length; j += 1000) {
        let bundles: Bundle[] = rows.slice(j, j + 1000)
        start = stopwatch()
        await g.apply(bundles)
        let ms = start().cpu
        applyMs += ms
        batchTimes.push(ms)
        peakRss = Math.max(peakRss, Deno.memoryUsage().rss)
      }
    }
    if (i % 200 == 0) {
      console.error(
        `load ${i}/${manifest.files.length}, apply ${Math.round(applyMs)}ms`,
      )
    }
  }
  driver.query({ t: 'pragma', name: 'wal_checkpoint' })
  let bytes = (await Deno.stat(db)).size
  await Deno.writeTextFile(
    out + '.load.json',
    JSON.stringify({ env, applyMs, spoolReadMs, peakRss, bytes }),
  )
  let small =
    manifest.files.map((f: { numeric: boolean }, i: number) =>
      f.numeric ? i : -1
    ).filter((i: number) => i >= 0).sort((a: number, b: number) =>
      Math.abs(manifest.files[a].nodes - 1000) -
      Math.abs(manifest.files[b].nodes - 1000)
    )[0]
  let large =
    manifest.files.map((f: { numeric: boolean }, i: number) =>
      f.numeric ? i : -1
    ).filter((i: number) => i >= 0).sort((a: number, b: number) =>
      manifest.files[b].nodes - manifest.files[a].nodes
    )[0]
  let edits = []
  await init()
  for (let i of [small, large]) {
    let file = manifest.files[i].file
    let before: FileTree = JSON.parse(
      await Deno.readTextFile(`${spool}/${i}.json`),
    )
    let source = await Deno.readTextFile(`${spool}/${i}.source`)
    start = stopwatch()
    let diff = edit(file, source, before)
    let diffMs = start().cpu
    let samples = []
    let growth = []
    // Repeat identical deltas, restoring outside timing, with the real graph path.
    let restore: Bundle[] = [...before.nodes, ...before.references]
    let oldIds = new Set(restore.map((r) => r.entity.eid))
    for (let r of [...diff.after.nodes, ...diff.after.references]) {
      if (!oldIds.has(r.entity.eid)) {
        restore.push({ entity: r.entity, $delete: true })
      }
    }
    for (let n = 0; n < 7; n++) {
      let sizeBefore = (await Deno.stat(db)).size
      start = stopwatch()
      await g.apply(diff.writes)
      samples.push(start().cpu)
      growth.push((await Deno.stat(db)).size - sizeBefore)
      // Compare actual read content, not just timing an unanswered query.
      let actual = g.read(`.node.file=${file}&.limit=1000000`) as Bundle[]
      let expected = new Map(
        diff.after.nodes.map((r) => [r.entity.eid, r.node]),
      )
      if (actual.length != expected.size) throw new Error(`edit count ${file}`)
      for (let r of actual) {
        let want = expected.get(r.entity.eid)
        let got = r.node as Record<string, unknown>
        if (!want || Object.entries(want).some(([k, v]) => got[k] !== v)) {
          throw new Error(`edit content ${r.entity.eid}`)
        }
      }
      await g.apply(restore)
    }
    edits.push({
      file,
      originalNodes: before.nodes.length,
      changedBundles: diff.writes.length,
      retained: diff.retained,
      parseDiffMs: diffMs,
      applyMs: summary(samples),
      fileGrowthBytes: growth,
    })
  }
  let subtreeIndex = manifest.files.map((_f: unknown, i: number) => i).sort((
    a: number,
    b: number,
  ) =>
    Math.abs(manifest.files[a].nodes - 10000) -
    Math.abs(manifest.files[b].nodes - 10000)
  )[0]
  let subtreeFile = manifest.files[subtreeIndex].file
  let subtree = await timedRead(() => ordered(g, subtreeFile))
  if (subtree.rows != manifest.files[subtreeIndex].nodes) {
    throw new Error('subtree count')
  }
  let edgeTree: FileTree = JSON.parse(
    await Deno.readTextFile(`${spool}/${large}.json`),
  )
  let edges = edgeTree
    .references as (Bundle & {
      reference: { source: string; target: string }
    })[]
  let counts = new Map<string, number>()
  for (let r of edges) {
    counts.set(r.reference.target, (counts.get(r.reference.target) ?? 0) + 1)
  }
  let [target, expected] = [...counts].sort((a, b) => b[1] - a[1])[0]
  let reverse = await timedRead(() =>
    g.read(`.reference.target=${target}&.limit=1000000`)
  )
  if (reverse.rows != expected) throw new Error('reverse reference count')
  let source = edges.find((r) => r.reference.target == target)!.reference.source
  let forward = await timedRead(() => g.read(`.reference.source=${source}`))
  if (forward.rows != 1) throw new Error('forward reference count')
  let rss = Deno.memoryUsage().rss
  driver.close?.()
  let restartStart = stopwatch()
  let restart = JSON.parse(
    await command(Deno.execPath(), [
      'run',
      '-A',
      import.meta.filename!,
      'restart',
      db,
      subtreeFile,
      String(subtree.rows),
    ]),
  )
  let restartProcessMs = restartStart().cpu
  let report = {
    env,
    corpusSha: manifest.sha,
    corpusHash: manifest.corpusHash,
    files: manifest.files.length,
    nodes: manifest.nodes,
    references: manifest.references,
    openMs,
    pragmas,
    spoolReadMs,
    applyMs,
    batchMs: summary(batchTimes),
    nodesPerSecond: manifest.nodes / (applyMs / 1000),
    bytes,
    bytesPerNode: bytes / manifest.nodes,
    peakRss,
    rss,
    rssPerNode: rss / manifest.nodes,
    edits,
    subtreeFile,
    subtree,
    target,
    reverse,
    forward,
    restart,
    restartProcessMs,
    endEnvironment: await environment(),
  }
  await Deno.writeTextFile(out, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      ...report,
      batchMs: { ...report.batchMs, samples: undefined },
    }),
  )
}
/** JSONB workloads share the parser, spool, graph composition and timing helpers
 * with the every-node baseline. The only extra SQL relation is a derived index;
 * it stores no AST values and is rebuilt from the stored JSONB, not the spool. */
async function coarse(
  spool: string,
  db: string,
  out: string,
  grain: 'file' | 'declaration',
) {
  if (!['file', 'declaration'].includes(grain)) throw new Error('coarse grain')
  try {
    await Deno.stat(db)
    throw new Error(`load requires a fresh database: ${db}`)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let manifest = JSON.parse(await Deno.readTextFile(`${spool}/manifest.json`))
  let env = await environment()
  let start = stopwatch()
  let { driver, g } = connect(db, true)
  let openMs = start().cpu
  let applyMs = 0, prepareMs = 0, spoolReadMs = 0, entities = 0
  let peakRss = Deno.memoryUsage().rss
  let batches: number[] = []
  let expectedRefs: {
    file: string
    id: number | string
    name: string
    target: string
  }[] = []
  let chosen: {
    i: number
    packed: Packed
    index: number
    literal: string
    functionId: string
  } | undefined
  let name = 'graph'
  for (let i = 0; i < manifest.files.length; i++) {
    start = stopwatch()
    let tree: FileTree = JSON.parse(
      await Deno.readTextFile(`${spool}/${i}.json`),
    )
    let source = await Deno.readTextFile(`${spool}/${i}.source`)
    spoolReadMs += start().cpu
    start = stopwatch()
    let packed = pack(tree, source, grain)
    prepareMs += start().cpu
    entities += packed.length
    for (let p of packed) {
      for (let n of p.tree.value.nodes) {
        if (n.name == name && n.target) {
          expectedRefs.push({
            file: p.tree.file,
            id: n.id,
            name,
            target: n.target,
          })
        }
      }
    }
    // Identical chosen function at either grain, deterministic corpus order.
    if (!chosen && tree.errors == 0 && tree.nodes.length >= 9000) {
      let f = functionLiteral(tree, source)
      if (f) {
        for (let p of packed) {
          let index = p.tree.value.nodes.findIndex((n) =>
            `${p.tree.file}#${n.id}` == f.function.entity.eid
          )
          if (index >= 0) {
            chosen = {
              i,
              packed: p,
              index,
              literal: f.literal.entity.eid,
              functionId: f.function.entity.eid,
            }
          }
        }
      }
    }
    for (let j = 0; j < packed.length; j += 1000) {
      start = stopwatch()
      await g.apply(packed.slice(j, j + 1000))
      let ms = start().cpu
      applyMs += ms
      batches.push(ms)
      peakRss = Math.max(peakRss, Deno.memoryUsage().rss)
    }
    if (i % 200 == 0) {
      console.error(
        `${grain} load ${i}/${manifest.files.length}, ${
          Math.round(applyMs)
        } ms`,
      )
    }
  }
  let size = () => {
    driver.query({ t: 'pragma', name: 'wal_checkpoint' })
    return Deno.statSync(db).size
  }
  let bytes = size()
  let storedNodes = Number(
    driver.query(
      select({
        cols: [
          as(
            fn('sum', fn('json_array_length', col('value'), val('$.nodes'))),
            'n',
          ),
        ],
        from: table('tree'),
      }),
    )[0].n,
  )
  if (storedNodes != manifest.nodes) throw new Error('stored node count')
  if (!chosen || !expectedRefs.length) throw new Error('missing query fixtures')
  let types = driver.query(
    select({
      cols: [as(fn('typeof', col('value')), 'type'), as(fn('count'), 'n')],
      from: table('tree'),
      group: [fn('typeof', col('value'))],
    }),
  )
  if (
    types.length != 1 || types[0].type != 'blob' ||
    Number(types[0].n) != entities
  ) throw new Error('not JSONB')
  let sqlite = driver.query(
    select({ cols: [as(fn('sqlite_version'), 'version')] }),
  )
  let pragmas = ['journal_mode', 'synchronous', 'page_size', 'cache_size'].map(
    (name) => ({ name, value: driver.query({ t: 'pragma', name }) }),
  )
  let owner = Number(
    driver.query(
      select({
        cols: [col('id')],
        from: table('entity'),
        where: eq(col('eid'), val(chosen.packed.entity.eid)),
      }),
    )[0].id,
  )
  let path = `$.nodes[${chosen.index}]`
  let nodeCols = [
    col('entity'),
    as(op('||', fn('json_extract', col('value'), val(path)), lit('')), 'node'),
  ]
  let nodeScan = select({
    cols: nodeCols,
    from: table('tree', undefined, false),
    where: and(
      eq(col('file'), val(chosen.packed.tree.file)),
      eq(col('start'), val(chosen.packed.tree.start)),
      eq(
        fn('json_extract', col('value'), val('$.nodes[0].id')),
        val(chosen.packed.tree.value.nodes[0].id),
      ),
    ),
  })
  let nodeIndexed = {
    ...nodeScan,
    from: table('tree', undefined, 'tree_location'),
  }
  let wantNode = JSON.stringify(chosen.packed.tree.value.nodes[chosen.index])
  let readNode = (q: Select) => {
    let rows = driver.query(q)
    if (rows.length != 1 || rows[0].node != wantNode) {
      throw new Error('node path answer')
    }
    return rows
  }
  let at = (key: string): Expr =>
    fn('json_extract', col('value', 'j'), val(`$.${key}`))
  let refsSource = call('json_tree', [col('value', 't'), val('$.nodes')], 'j')
  let refsWhere = and(
    eq(col('type', 'j'), lit('object')),
    notNull(at('target')),
  )
  let refCols = [
    as(col('entity', 't'), 'owner'),
    as(col('fullkey', 'j'), 'path'),
    as(op('||', col('value', 'j'), lit('')), 'node'),
  ]
  let refScan = select({
    cols: refCols,
    from: table('tree', 't'),
    joins: [cross(refsSource)],
    where: and(refsWhere, eq(at('name'), val(name))),
  })
  let plans: Record<string, unknown> = {}
  let plan = (label: string, q: Select) =>
    plans[label] = driver.query({ t: 'explain query plan', of: q })
  plan('nodeScan', nodeScan)
  plan('referenceScan', refScan)
  let sort = (rows: Record<string, unknown>[]) =>
    rows.sort((a, b) =>
      Number(a.owner) - Number(b.owner) ||
      String(a.path).localeCompare(String(b.path))
    )
  let expected = expectedRefs.map((r) => JSON.stringify(r)).sort()
  let checkRefs = (rows: Record<string, unknown>[]) => {
    let got = rows.map((r) => {
      let node = JSON.parse(String(r.node))
      return JSON.stringify({
        file: String(node.target).split('#')[0],
        id: node.id,
        name: node.name,
        target: node.target,
      })
    }).sort()
    if (JSON.stringify(got) != JSON.stringify(expected)) {
      throw new Error('reference answer')
    }
    return sort(rows)
  }
  let nodeScanRead = timedRead(() => readNode(nodeScan))
  let beforeLocationBytes = size()
  start = stopwatch()
  driver.query({
    t: 'create index',
    name: 'tree_location',
    on: 'tree',
    cols: [col('file'), col('start')],
  })
  let locationMs = start().cpu
  let locationBytes = size() - beforeLocationBytes
  plan('nodeIndexed', nodeIndexed)
  let nodeIndexedRead = timedRead(() => readNode(nodeIndexed))
  // Scans use seven warm repetitions: traversing the whole corpus is deliberate.
  let referenceScan = timedRead(() => checkRefs(driver.query(refScan)), 7)
  let graphFunction = timedRead(() => {
    let rows = g.read(`.entity.eid=${chosen!.packed.entity.eid}`) as Bundle[]
    let nodes = (rows[0].tree as Packed['tree']).value.nodes
    let root = nodes[chosen!.index]
    let result = nodes.filter((n, i) =>
      i >= chosen!.index && n.start >= root.start && n.end <= root.end
    )
    if (JSON.stringify(root) != wantNode || !result.length) {
      throw new Error('function answer')
    }
    return result
  })
  let beforeIndexBytes = size()
  start = stopwatch()
  driver.query({
    t: 'create table',
    name: 'name_path',
    cols: [{ name: 'owner', type: 'integer', notNull: true }, {
      name: 'path',
      type: 'text',
      notNull: true,
    }, { name: 'name', type: 'text', notNull: true }],
  })
  // Build every baseline reference source's name/path, not only the timed name.
  driver.query({
    t: 'insert',
    into: 'name_path',
    cols: ['owner', 'path', 'name'],
    q: select({
      cols: [col('entity', 't'), col('fullkey', 'j'), at('name')],
      from: table('tree', 't'),
      joins: [cross(refsSource)],
      where: refsWhere,
    }),
  })
  let indexExtractMs = start().cpu
  let sideTableBytes = size() - beforeIndexBytes
  start = stopwatch()
  driver.query({
    t: 'create index',
    name: 'name_path_name',
    on: 'name_path',
    cols: [col('name'), col('owner'), col('path')],
  })
  let indexBuildMs = start().cpu
  let indexBytes = size() - beforeIndexBytes - sideTableBytes
  let sideRows = Number(
    driver.query(
      select({ cols: [as(fn('count'), 'n')], from: table('name_path') }),
    )[0].n,
  )
  if (sideRows != manifest.references) throw new Error('side table count')
  let refIndexed = select({
    cols: [
      as(col('owner', 'i'), 'owner'),
      col('path', 'i'),
      as(
        op(
          '||',
          fn('json_extract', col('value', 't'), col('path', 'i')),
          lit(''),
        ),
        'node',
      ),
    ],
    from: table('name_path', 'i'),
    joins: [
      join(table('tree', 't'), eq(col('entity', 't'), col('owner', 'i'))),
    ],
    where: eq(col('name', 'i'), val(name)),
  })
  plan('referenceIndexed', refIndexed)
  let referenceIndexed = timedRead(() => checkRefs(driver.query(refIndexed)))
  // Equal path/node answers, not merely equal hit counts.
  if (
    JSON.stringify(sort(driver.query(refScan))) !=
      JSON.stringify(sort(driver.query(refIndexed)))
  ) throw new Error('scan/index disagreement')
  await init()
  let original: FileTree = JSON.parse(
    await Deno.readTextFile(`${spool}/${chosen.i}.json`),
  )
  let source = await Deno.readTextFile(`${spool}/${chosen.i}.source`)
  start = stopwatch()
  let diff = edit(
    chosen.packed.tree.file,
    source,
    original,
    original.nodes.find((n) => n.entity.eid == chosen!.literal)!,
  )
  if (
    diff.after.errors != original.errors ||
    diff.after.nodes[0].node.kind != original.nodes[0].node.kind
  ) throw new Error('edit changed parse validity')
  let after = pack(diff.after, diff.changed, grain),
    before = pack(original, source, grain)
  let prior = new Map(before.map((p) => [p.entity.eid, p]))
  let changed = after.filter((p) =>
    JSON.stringify(p) != JSON.stringify(prior.get(p.entity.eid))
  )
  let valueChanged = changed.filter((p) =>
    JSON.stringify(p.tree.value) !=
      JSON.stringify(prior.get(p.entity.eid)?.tree.value)
  )
  let changedValueIds = new Set(valueChanged.map((p) => p.entity.eid))
  let writes: Bundle[] = changed.map((p) =>
    changedValueIds.has(p.entity.eid)
      ? p
      : { entity: p.entity, tree: { start: p.tree.start } }
  )
  let live = new Set(after.map((p) => p.entity.eid))
  for (let p of before) {
    if (!live.has(p.entity.eid)) {
      writes.push({ entity: p.entity, $delete: true })
    }
  }
  let prepareEditMs = start().cpu
  let restore: Bundle[] = [
    ...before,
    ...after.filter((p) => !prior.has(p.entity.eid)).map((p) => ({
      entity: p.entity,
      $delete: true,
    })),
  ]
  let valueBytesRewritten = valueChanged.reduce(
    (n, p) => n + new TextEncoder().encode(JSON.stringify(p.tree.value)).length,
    0,
  )
  let valueChanges = after.filter((p) =>
    JSON.stringify(p.tree.value) !=
      JSON.stringify(prior.get(p.entity.eid)?.tree.value)
  ).length
  let editGraph: number[] = [], editIndex: number[] = []
  let transaction = (body: () => void) => {
    driver.query({ t: 'begin', mode: 'immediate' })
    try {
      body()
      driver.query({ t: 'commit' })
    } catch (e) {
      driver.query({ t: 'rollback' })
      throw e
    }
  }
  let refresh = (ids: string[]) => {
    for (let eid of ids) {
      let owner = driver.query(
        select({
          cols: [col('id')],
          from: table('entity'),
          where: eq(col('eid'), val(eid)),
        }),
      )[0]?.id
      if (owner == null) continue
      driver.query({
        t: 'delete',
        from: 'name_path',
        where: eq(col('owner'), val(Number(owner))),
      })
      driver.query({
        t: 'insert',
        into: 'name_path',
        cols: ['owner', 'path', 'name'],
        q: select({
          cols: [col('entity', 't'), col('fullkey', 'j'), at('name')],
          from: table('tree', 't'),
          joins: [cross(refsSource)],
          where: and(refsWhere, eq(col('entity', 't'), val(Number(owner)))),
        }),
      })
    }
  }
  let ids = [
    ...changedValueIds,
    ...before.filter((p) => !live.has(p.entity.eid)).map((p) => p.entity.eid),
  ]
  for (let i = 0; i < 7; i++) {
    start = stopwatch()
    await g.apply(writes)
    editGraph.push(start().cpu)
    start = stopwatch()
    transaction(() => refresh(ids))
    editIndex.push(start().cpu)
    let actual = g.read(
      `.tree.file=${chosen.packed.tree.file}&.limit=1000000`,
    ) as Bundle[]
    let got = actual.map((p) => ({
      entity: { eid: p.entity.eid },
      tree: p.tree,
    })).sort((a, b) => a.entity.eid.localeCompare(b.entity.eid))
    let want = after.toSorted((a, b) =>
      a.entity.eid.localeCompare(b.entity.eid)
    )
    if (JSON.stringify(got) != JSON.stringify(want)) {
      throw new Error('coarse edit roundtrip')
    }
    await g.apply(restore)
    transaction(() => refresh(ids))
  }
  // Verify again after restores and in an independently reopened connection.
  checkRefs(driver.query(refIndexed))
  let finalBytes = size()
  driver.close()
  let reopened = open(db, { readOnly: true })
  let reopenRows = reopened.query(nodeIndexed)
  if (reopenRows.length != 1 || reopenRows[0].node != wantNode) {
    throw new Error('reopen node')
  }
  checkRefs(reopened.query(refIndexed))
  reopened.close()
  let report = {
    grain,
    env,
    storedNodes,
    engineSha: await command('git', ['rev-parse', 'HEAD']),
    corpusSha: manifest.sha,
    corpusHash: manifest.corpusHash,
    files: manifest.files.length,
    nodes: manifest.nodes,
    references: manifest.references,
    entities,
    openMs,
    spoolReadMs,
    prepareMs,
    applyMs,
    batchMs: summary(batches),
    bytes,
    bytesPerNode: bytes / manifest.nodes,
    peakRss,
    sqlite,
    pragmas,
    types,
    fixture: {
      file: chosen.packed.tree.file,
      functionId: chosen.functionId,
      owner,
      path,
      name,
      hits: expectedRefs.length,
    },
    nodeScan: nodeScanRead,
    nodeIndexed: nodeIndexedRead,
    graphFunction,
    referenceScan,
    referenceIndexed,
    locationIndex: { bytes: locationBytes, buildMs: locationMs },
    index: {
      rows: sideRows,
      extractMs: indexExtractMs,
      buildMs: indexBuildMs,
      sideTableBytes,
      indexBytes,
      totalBytes: sideTableBytes + indexBytes,
      totalMs: indexExtractMs + indexBuildMs,
    },
    edit: {
      bundles: writes.length,
      valueChanges,
      valueBytesRewritten,
      prepareMs: prepareEditMs,
      graphMs: summary(editGraph),
      indexMs: summary(editIndex),
      atomic: false,
    },
    plans,
    finalBytes,
    endEnvironment: await environment(),
  }
  await Deno.writeTextFile(out, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      ...report,
      batchMs: { ...report.batchMs, samples: undefined },
    }),
  )
}

if (import.meta.main) {
  let [mode, a, b, c] = Deno.args
  if (mode == 'parse') await parse(a, b)
  else if (mode == 'run') await run(a, b, c)
  else if (mode == 'coarse') {
    await coarse(a, b, c, Deno.args[4] as 'file' | 'declaration')
  } else if (mode == 'restart') {
    let start = stopwatch()
    let { driver, g } = connect(a)
    let openMs = start().cpu
    start = stopwatch()
    let rows = ordered(g, b) as Bundle[]
    let readMs = start().cpu
    if (rows.length != Number(c)) throw new Error('restart count')
    console.log(
      JSON.stringify({
        timing: 'cpu',
        timeUnit: 'ms',
        openMs,
        readMs,
        rows: rows.length,
        rss: Deno.memoryUsage().rss,
      }),
    )
    driver.close?.()
  } else throw new Error('usage: yardstick.ts parse|run|restart ...')
}

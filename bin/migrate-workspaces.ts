// One-time owner-data cutover. Open only the explicitly named database; compose
// words, never a host, so no service, importer or provisioning can run.
import { words } from '../packages/cli/words.ts'
import { read } from '../packages/cli/config.ts'
import { open } from '../packages/sqlite/db.ts'
import { reclassify, schema, storage } from '@yaks/sqlite'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { archetypes } from '@yaks/archetype'
import { journal, log } from '@yaks/journal'
import { aliases } from '@yaks/alias'
import { ids as numbered } from '@yaks/id/graph'
import { createHash } from 'node:crypto'
import { loadVocab } from '@yaks/vocab'
import sandbox from '../packages/sandbox/vocab.json' with { type: 'json' }
import {
  and,
  as,
  col,
  eq,
  fn,
  gt,
  isNull,
  le,
  lit,
  oneOf,
  or,
  select,
  star,
  type Stmt,
  table,
} from '@yaks/sql'

let [config, path, mode = 'check'] = Deno.args
if (!config || !path || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: migrate-workspaces.ts CONFIG ABSOLUTE_DB check|apply')
}
let loaded = await words(read(config))
let docs = structuredClone(loaded.docs)
for (
  let [c, props] of Object.entries({
    machine: {
      provider: { type: 'string' },
      from: { type: 'string', ref: 'gitobj', death: 'keep' },
      image: { type: 'string' },
      state: { type: 'string' },
    },
    home: { machine: { type: 'string', ref: 'entity', death: 'keep' } },
    worktree: { path: { type: 'string' } },
  })
) {
  let d = docs.find((d) => d.$defs?.[c]?.component === true)
  if (!d) throw Error('Full owner vocabulary missing ' + c)
  Object.assign(d.$defs![c].properties ??= {}, props)
}
let vocab = loadVocab([...docs, sandbox], loaded.vocab.keywords)
let db = open(path)
let existing = new Set(
  db.query(select({ from: table('sqlite_schema') })).map((r) => String(r.name)),
)
for (let stmt of schema(vocab, loaded.derived)) {
  if (stmt.t === 'create table' && !existing.has(stmt.name)) db.query(stmt)
}
let store = storage(db, vocab, {
  derived: loaded.derived,
  backed: loaded.backed,
})
let g = graph({
  storage: store,
  vocab,
  plugins: [
    archetypes(),
    numbered(vocab),
    aliases(),
    journal(log({ rows: (s) => db.query(s), derived: loaded.derived }), vocab),
  ],
})
let say = (name: string, value: unknown) =>
  console.log(JSON.stringify({ name, value }))
let assert = (value: unknown, message: string) => {
  if (!value) throw Error(message)
}
let query = (name: string) => db.query(select({ from: table(name) }))
let by = (name: string, value: string | number) => eq(col(name), lit(value))
let update = (
  name: string,
  set: Record<string, unknown>,
  key: string,
  value: string | number,
) =>
  db.query(
    {
      t: 'update',
      table: name,
      set: Object.fromEntries(
        Object.entries(set).map((
          [k, v],
        ) => [k, lit(v as string | number | null)]),
      ),
      where: by(key, value),
    } as Stmt,
  )
let number = (eid: string) =>
  Number(
    db.query(select({ from: table('entity'), where: by('eid', eid) }))[0]?.id,
  )
let batches = async (patches: Bundle[]) => {
  for (let i = 0; i < patches.length; i += 100) {
    await g.apply(patches.slice(i, i + 100), { trusted: true, stamp: false })
  }
}
let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
let count = () =>
  Object.fromEntries(
    [
      'machine',
      'workspace',
      'home',
      'repository',
      'worktree',
      'file',
      'ref',
      'process',
      'journal_tx',
      'journal_change',
    ].map(
      (t) => [
        t,
        db.query(
          select({ cols: [fn('count', star())], from: table(t) }),
        )[0]['count(*)'],
      ],
    ),
  )
await store.tx(async () => {
  let counts = count()
  say('before', counts)
  let protectedTables = [
    'entry',
    'session',
    'log',
    'content',
    'attachment',
    'ask',
    'output',
    'call',
    'created',
  ]
  let protectedEnds = Object.fromEntries(
    protectedTables.filter((t) => existing.has(t)).map(
      (t) => [
        t,
        db.query(
          select({
            cols: [as(fn('max', col('entity')), 'last')],
            from: table(t),
          }),
        )[0].last,
      ],
    ),
  )
  let fingerprint = (t: string, key: string, end: number) => {
    let hash = createHash('sha256'), n = 0, after = 0
    for (;;) {
      let page = db.query(
        select({
          from: table(t),
          where: and(gt(col(key), lit(after)), le(col(key), lit(end))),
          order: [col(key)],
          limit: lit(250),
        }),
      )
      if (!page.length) break
      for (let row of page) {
        for (let [key, value] of Object.entries(row)) {
          hash.update(key)
          hash.update(':')
          if (value instanceof Uint8Array) {
            hash.update('bytes:')
            hash.update(value)
          } else hash.update(JSON.stringify(value))
          hash.update(';')
        }
        hash.update('\n')
      }
      n += page.length
      after = Number(page.at(-1)![key])
    }
    return { hash: hash.digest('hex'), n }
  }
  let fingerprints = () =>
    Object.fromEntries(
      Object.entries(protectedEnds).map((
        [t, end],
      ) => [t, fingerprint(t, 'entity', Number(end))]),
    )
  let baseline = fingerprints()
  say('protected-before', baseline)
  let journalEnds = Object.fromEntries(
    ['journal_tx', 'journal_change'].map(
      (t) => [
        t,
        db.query(
          select({ cols: [as(fn('max', col('id')), 'last')], from: table(t) }),
        )[0].last,
      ],
    ),
  )
  let journalPrefix = () =>
    Object.fromEntries(
      Object.entries(journalEnds).map((
        [t, end],
      ) => [t, fingerprint(t, 'id', Number(end))]),
    )
  let history = journalPrefix()
  say('history-before', history)
  let redirects = new Map<string, string>()
  let canonical = (eid: string): string =>
    redirects.has(eid) ? canonical(redirects.get(eid)!) : eid
  // Move an identity in place where possible: numeric foreign keys and the entire
  // journal still identify the same object. Existing canonical observations merge
  // only after every stored reference has been rewired in this transaction.
  let rename = async (old: string, target: string) => {
    if (old === target) return
    target = canonical(target)
    let oldId = number(old), targetId = number(target)
    assert(oldId, 'Missing source ' + old)
    if (!targetId) update('entity', { eid: target }, 'id', oldId)
    else {
      let [a, b] = await g.get([old, target])
      assert(
        !a.session && !b.session,
        'Cannot merge sessions as filesystem observations',
      )
      // Qualified observations may have arrived since the copy was taken.
      // Coalesce dependent identities before moving a unique parent reference.
      if (a.repository) {
        let prior = db.query(
          select({ from: table('file'), where: by('repository', oldId) }),
        )
        for (let f of prior) {
          let same = db.query(
            select({
              from: table('file'),
              where: and(
                by('repository', targetId),
                by('path', String(f.path)),
              ),
            }),
          )[0]
          if (same) {
            let from = db.query(
              select({
                from: table('entity'),
                where: by('id', Number(f.entity)),
              }),
            )[0]
            let to = db.query(
              select({
                from: table('entity'),
                where: by('id', Number(same.entity)),
              }),
            )[0]
            await rename(String(from.eid), String(to.eid))
          }
        }
      }
      if (a.file) {
        let prior = db.query(
          select({ from: table('symbol'), where: by('module', oldId) }),
        )
        for (let sym of prior) {
          let same = db.query(
            select({
              from: table('symbol'),
              where: and(
                by('module', targetId),
                by('name', String(sym.name)),
              ),
            }),
          )[0]
          if (same) {
            let from = db.query(
              select({
                from: table('entity'),
                where: by('id', Number(sym.entity)),
              }),
            )[0]
            let to = db.query(
              select({
                from: table('entity'),
                where: by('id', Number(same.entity)),
              }),
            )[0]
            await rename(String(from.eid), String(to.eid))
          }
        }
      }
      let patch: Bundle = { entity: { eid: target } }
      for (let [name, value] of Object.entries(a)) {
        if (
          ['entity', '$was', '$actor', 'created', 'updated'].includes(name) ||
          name.startsWith('$') || !value
        ) continue
        let other = comp(b, name)
        let merged = { ...value as Comp, ...other }
        patch[name] = merged
      }
      await g.apply([patch], { trusted: true, stamp: false })
      for (let [name, prop] of vocab.refProps()) {
        if (
          !db.query({ t: 'pragma', name: 'table_info', arg: name }).some((r) =>
            r.name === prop
          )
        ) continue
        update(name, { [prop]: targetId }, prop, oldId)
      }
      // The old numbered entity becomes an address, not a second repository/file.
      let clear: Bundle = { entity: { eid: old }, tombstone: {} }
      for (let name of Object.keys(a)) {
        if (
          !name.startsWith('$') &&
          !['entity', 'created', 'updated'].includes(name)
        ) clear[name] = null
      }
      // Tombstoning a merged facet must not erase any immutable owner text or
      // its writer. Keep their exact physical rows on the historical address.
      let retained = [
        'created',
        'doc',
        'content',
        'attachment',
        'ask',
        'output',
        'call',
        'entry',
        'session',
        'log',
      ].flatMap((t) => {
        if (!existing.has(t)) return []
        let r =
          db.query(select({ from: table(t), where: by('entity', oldId) }))[0]
        return r ? [[t, r] as const] : []
      })
      await g.apply([clear], { trusted: true, stamp: false })
      for (let [t, r] of retained) {
        db.query({
          t: 'insert',
          into: t,
          or: 'ignore',
          cols: Object.keys(r),
          rows: [Object.values(r).map((v) => lit(v as string | number | null))],
        })
      }
      if (retained.length) reclassify(db, [old])
    }
    redirects.set(old, target)
  }

  let local = await g.read('.machine.address=local://')
  assert(local.length === 1, 'Exactly one explicit local computer required')
  let computer = local[0].entity.eid
  let filesystem = derivedEid('computer filesystem|' + computer)
  if (!(await g.get([filesystem], ['workspace']))[0]?.workspace) {
    await g.apply([{
      entity: { eid: filesystem },
      workspace: { machine: computer, root: '/' },
    }], { trusted: true, stamp: false })
  }
  // Old process providers ran on this box. An attached directory is a workspace,
  // not a resource. Keep its eid, all session references, paths and files intact.
  let machines = await g.read('.machine *')
  let moved = 0
  for (let b of machines) {
    let m = comp(b, 'machine')!
    if (m.provider == null) continue
    assert(m.provider === 'process', 'Unmapped provider ' + m.provider)
    let root = typeof m.address === 'string' && m.address.startsWith('/')
      ? m.address
      : undefined
    if (!root) {
      let candidate = '/home/yaks/.yak/machines/' + b.entity.eid
      try {
        if ((await Deno.stat(candidate)).isDirectory) {
          root = await Deno.realPath(candidate)
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e
      }
    }
    // A request that never acquired an address has no known placement.
    // Keep the intention/provenance without inventing a path on this host.
    await g.apply([{
      entity: b.entity,
      machine: null,
      workspace: root ? { machine: computer, root } : {},
      ...(!root
        ? {
          sandbox: {
            provider: 'process',
            ...m.from ? { from: m.from } : {},
            ...m.image ? { image: m.image } : {},
          },
        }
        : {}),
    }], { trusted: true, stamp: false })
    moved++
  }
  let homes = await g.read('.home *')
  await batches(
    homes.filter((b) => comp(b, 'home')?.machine).map((b) => ({
      entity: b.entity,
      home: {
        workspace: comp(b, 'home')!.workspace ?? comp(b, 'home')!.machine,
        machine: null,
      },
    })),
  )
  say('machines', { moved })
  let repos = await g.read('.repository *')
  for (let b of repos) {
    let r = comp(b, 'repository')!
    if (r.workspace) continue
    let target = identityEid('repository', [filesystem, String(r.common)])
    // Setting the context after renaming satisfies identity admission.
    await rename(b.entity.eid, target)
    await g.apply([{
      entity: { eid: target },
      repository: { workspace: filesystem },
    }], { trusted: true, stamp: false })
  }
  say('repositories', { redirects: redirects.size })
  let files = await g.read('.file *')
  for (let b of files) {
    let f = comp(b, 'file')!
    await rename(
      b.entity.eid,
      identityEid('file', [String(f.path), String(f.repository)]),
    )
  }
  for (let b of await g.read('.symbol *')) {
    let r = comp(b, 'symbol')!
    await rename(
      b.entity.eid,
      identityEid('symbol', [String(r.module), String(r.name)]),
    )
  }
  say('files-symbols', { redirects: redirects.size })
  let refs = await g.read('.ref *')
  for (let b of refs) {
    let r = comp(b, 'ref')!
    if (r.app) {
      await rename(b.entity.eid, derivedEid('ref|' + r.app + '|' + r.name))
    }
  }
  say('refs', { redirects: redirects.size })
  let trees = await g.read('.worktree *')
  for (let b of trees) {
    let w = comp(b, 'worktree')!, at = comp(b, 'workspace')
    let root = at?.root ?? w.path
    if (!root) {
      if (at) continue
      await g.apply([{ entity: b.entity, workspace: {} }], {
        trusted: true,
        stamp: false,
      })
      continue
    }
    let target = derivedEid('worktree|' + w.repository + '|' + root)
    if (
      !b.session && target === b.entity.eid && w.path == null &&
      at?.root === root
    ) continue
    if (b.session) {
      // Imported sessions historically wore a worktree observation. Moving
      // that facet must never merge their transcripts or session identities.
      await g.apply([{
        entity: { eid: target },
        workspace: { machine: computer, root },
        worktree: { ...w, path: null },
      }, {
        entity: b.entity,
        worktree: null,
        ...(!comp(b, 'home')?.workspace && !comp(b, 'home')?.machine
          ? { home: { workspace: target } }
          : {}),
      }], {
        trusted: true,
        stamp: false,
      })
    } else {
      await rename(b.entity.eid, target)
      await g.apply([{
        entity: { eid: target },
        workspace: { machine: computer, root },
        worktree: { path: null },
      }], { trusted: true, stamp: false })
    }
  }
  say('worktrees', { redirects: redirects.size })
  let changedIds = [
    ...new Set([...redirects.values()].map(canonical).map(number)),
  ]
  let edgeIds = new Set<number>()
  for (let i = 0; i < changedIds.length; i += 500) {
    let part = changedIds.slice(i, i + 500)
    for (
      let r of db.query(
        select({
          from: table('edge'),
          where: or(oneOf(col('from'), part), oneOf(col('to'), part)),
        }),
      )
    ) edgeIds.add(Number(r.entity))
  }
  let candidates = [...edgeIds]
  for (let i = 0; i < candidates.length; i += 500) {
    let at = db.query(
      select({
        from: table('entity'),
        where: oneOf(col('id'), candidates.slice(i, i + 500)),
      }),
    ).map((r) => String(r.eid))
    for (let b of await g.get(at)) {
      let e = comp(b, 'edge')!
      let tag = Object.keys(b).find((c) => c !== 'edge' && vocab.def(c)?.edge)
      if (tag) {
        await rename(b.entity.eid, derivedEid(e.from + '|' + tag + '|' + e.to))
      }
    }
  }
  say('edges', { candidates: candidates.length, redirects: redirects.size })
  // Process recovery belongs to its original computer, even after a home switch.
  let n = number(filesystem)
  db.query(
    {
      t: 'update',
      table: 'process',
      set: { workspace: lit(n) },
      where: isNull(col('workspace')),
    } as Stmt,
  )
  // Addresses handed out before the move continue resolving; these are ordinary
  // alias keys, not a second copy of any moved object's data.
  for (let [old, target] of redirects) {
    let eid = derivedEid('alias|' + old)
    await g.apply([{
      entity: { eid },
      key: { of: canonical(target), value: old },
      alias: {},
    }], { trusted: true, stamp: false })
  }
  reclassify(db, [...new Set([...redirects.values()])])
  assert(!query('home').some((r) => r.machine != null), 'Old homes remain')
  let after = count()
  say('protected-after', fingerprints())
  assert(
    JSON.stringify(fingerprints()) === JSON.stringify(baseline),
    'Owner transcript/content/created rows changed',
  )
  assert(
    JSON.stringify(journalPrefix()) === JSON.stringify(history),
    'Existing journal prefix changed',
  )
  say('preserved', { protected: baseline, journal: history })
  say('after', {
    counts: after,
    machinesMoved: moved,
    redirects: redirects.size,
  })
  assert(
    !db.query({ t: 'pragma', name: 'foreign_key_check' }).length,
    'Foreign key failures',
  )
  say('integrity', db.query({ t: 'pragma', name: 'quick_check' }))
  if (mode === 'apply') {
    await Deno.writeTextFile(
      path + '.redirects.json',
      JSON.stringify(Object.fromEntries(redirects)),
    )
  }
  if (mode === 'check') throw Error('REHEARSAL_ROLLBACK')
}).catch((e) => {
  if (e.message !== 'REHEARSAL_ROLLBACK') throw e
}).finally(() => db.close())

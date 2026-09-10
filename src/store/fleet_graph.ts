// The package graph bound to the fleet's existing SQL layout. This is storage
// composition plus registered fleet policy; live mutation stays on its old
// path until the remaining admission/entry/effect doors switch. Hooks on this
// Sql-backed handle must be synchronous (the driver transaction contract).
import {
  type ApplyOpts,
  type Bundle,
  Checked,
  type Comp,
  comps,
  dead,
  type Entity,
  type Graph,
  graph,
  type Plugin,
  then,
} from '@yaks/graph'
import { blobRead, blobs, decode, encode } from '@yaks/blob'
import { type Driver, storage, touched } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { fleetStamps, type FleetWrite, type StampHost } from './fleet_stamps.ts'
import { derived } from '../sql_derived.ts'
import { sha } from '../sha.ts'
import type { Sql } from './sql.ts'
import {
  auditFleetBounce,
  fleetPreconditions,
  type GuardHost,
} from './fleet_preconditions.ts'

// db.ts owns prepared statements, the fleet's kind-based number allocator,
// and its canonical hydrated component read. Keep those truths single-owned.
export type FleetGraphHost = {
  db: Sql
  driver: Driver
  vocab: Vocab
  normalizers: Plugin[]
  guards: GuardHost
  lifecycle: StampHost
  refusal: (err: unknown) => unknown
  number: (eid: string) => void
  component: (eid: string, name: string) => Comp | undefined
}

export type FleetGraph = Graph & {
  write: (
    changes: Bundle[],
    context: FleetWrite,
    opts?: ApplyOpts,
  ) => Bundle[] | Promise<Bundle[]>
}

export let fleetGraph = (host: FleetGraphHost): FleetGraph => {
  let { db, driver, vocab } = host
  let lifecycle = fleetStamps(host.lifecycle)
  // Only doc.body has migrated to CAS in the fleet. The other `body`-typed
  // columns still hold inline text; treating every body as a blob loses them.
  let columns = [{ comp: 'doc', prop: 'body' }]
  let reads = blobRead(vocab, { key: 'entity' })
  let store = storage(driver, vocab, {
    derived: { ...derived, 'doc.body': reads['doc.body'] },
    number: false,
  })
  let row = (sql: string, ...params: string[]) => driver.query(sql, params)[0]
  let owner = '(select id from entity where eid = ?)'

  // The driver owns transactions (including Durable Object transactionSync).
  // Number births only once ALL their components have landed: an edge/blob/
  // entry must never consume a human number just because its spine came first.
  let bound: typeof store = {
    ...store,
    tx: (body) =>
      store.tx((tx) => {
        let born: Entity[] = []
        let finish = () => {
          for (let entity of born) {
            if (
              row(`select 1 from tombstone where entity = ${owner}`, entity.eid)
            ) continue
            host.number(entity.eid)
            let held = row('select num from entity where eid = ?', entity.eid)
            entity.num = held?.num == null ? null : Number(held.num)
          }
        }
        try {
          let out = body({
            ...tx,
            remove: (entities) => {
              for (let e of entities) {
                let held = tx.get([e.eid])
                if (held instanceof Promise) {
                  throw new Error('fleet storage must be synchronous')
                }
                lifecycle.remove(
                  e.eid,
                  held.flatMap((b) => comps(b).map(([name]) => name)),
                )
              }
              return tx.remove(entities)
            },
            patch: (bundles) => {
              // SQLite checks INSERT's NOT NULL constraints before its UPSERT
              // conflict arm. Existing doc/setting/alias/session patches must supply omitted
              // required values for that check, without echoing them as caller writes.
              // Work in order: two patches for one doc see each other's rows.
              // Mint all references first through the package, then patch each
              // bundle with current required values as insert defaults.
              let identities = tx.patch(
                [...new Set(touched(vocab, bundles))].map((eid) => ({
                  entity: { eid },
                })),
              )
              born.push(...identities)
              lifecycle.born(identities.map((e) => e.eid))
              for (let b of bundles) {
                lifecycle.patch(b)
                let doc = b.doc as Comp | null | undefined
                let held = doc && row(
                  `select title, body from doc where entity = ${owner}`,
                  b.entity.eid,
                )
                let setting = b.setting as Comp | null | undefined
                let key = setting && row(
                  `select key from setting where entity = ${owner}`,
                  b.entity.eid,
                )
                let alias = b.alias as Comp | null | undefined
                let slug = alias && row(
                  `select slug from alias where entity = ${owner}`,
                  b.entity.eid,
                )
                let session = b.session as Comp | null | undefined
                let id = session && row(
                  `select id from session where entity = ${owner}`,
                  b.entity.eid,
                )
                tx.patch([{
                  ...b,
                  ...(doc ? { doc: { ...held, ...doc } } : {}),
                  ...(setting ? { setting: { ...key, ...setting } } : {}),
                  ...(alias ? { alias: { ...slug, ...alias } } : {}),
                  ...(session ? { session: { ...id, ...session } } : {}),
                }])
              }
              return identities
            },
          })
          finish()
          return out
        } catch (e) {
          // A dry run returns exact birth identities too, but rolls back their
          // allocation together with the documents and bytes.
          if (e instanceof Checked) finish()
          throw e
        }
      }),
  }

  let prepare: Plugin = {
    name: 'fleet/blob-entities',
    hooks: {
      // Core $was has ALREADY passed against hydrated text. Defaults and blob
      // materialization belong here, not normalize (which runs before $was).
      precondition: (bundles, tx) =>
        then(
          tx.get([...new Set(bundles.map((b) => b.entity.eid))]),
          (found) => {
            let state = new Map(found.map((b) => [b.entity.eid, b]))
            let made = new Map<string, Bundle>()
            let out = bundles.flatMap((b) => {
              let held = state.get(b.entity.eid)
              if (held && dead(held)) return []
              if (dead(b)) {
                state.set(b.entity.eid, { entity: b.entity, tombstone: {} })
                return [b]
              }
              let created = comps(b).filter(([name, patch]) =>
                patch != null && held?.[name] == null
              ).map(([name]) => name)
              let doc = b.doc as Comp | null | undefined
              let next = {
                ...b,
                ...(doc && held?.doc == null
                  ? { doc: { title: '', body: '', ...doc } }
                  : {}),
                $fleetCreated: Object.fromEntries(
                  created.map((name) => [name, true]),
                ),
              }
              state.set(b.entity.eid, { ...held, ...next })
              let value = (next.doc as Comp | null | undefined)?.body
              if (typeof value == 'string') {
                let eid = sha(value)
                if (
                  !made.has(eid) && !row(
                    `select 1 from blob where entity = ${owner}`,
                    eid,
                  )
                ) {
                  made.set(eid, {
                    entity: { eid },
                    blob: { bytes: encode(value).byteLength },
                    $fleetCreated: { blob: true },
                    $fleetMaterialized: true,
                  })
                }
              }
              return [next]
            })
            let materialized = [...made.values()]
            // These are graph entities, not a private (sha,value) table. Patch
            // through the transaction so gathers/stamps see their births, and
            // carry the returned identities into the authoritative echo.
            return then(tx.patch(materialized), (born) => {
              lifecycle.materialized(materialized)
              for (let b of materialized) {
                b.entity = born.find((e) => e.eid == b.entity.eid) ?? b.entity
              }
              return [...materialized, ...out]
            })
          },
        ),
    },
  }
  let cas = blobs(vocab, {
    has: (eid) => !!row(`select 1 from blob_text where entity = ${owner}`, eid),
    get: (eid) => {
      let held = row(`select value from blob_text where entity = ${owner}`, eid)
      return held ? encode(String(held.value)) : undefined
    },
    put: (eid, bytes) => {
      driver.query(
        `insert or ignore into blob_text (entity, value) values (${owner}, ?)`,
        [eid, decode(bytes)],
      )
    },
  }, {
    columns,
    reference: (eid) => {
      let held = row('select id from entity where eid = ?', eid)
      if (!held) throw new Error(`missing blob entity ${eid}`)
      return Number(held.id)
    },
  })
  let echoes: Plugin = {
    name: 'fleet/created-rows',
    hooks: {
      // After @yaks/blob restores text, fill new components from their whole
      // writable rows. Patches stay patches; server columns ride stamp echoes.
      commit: (bundles) => {
        let full = new Map<string, Bundle>()
        for (let key of lifecycle.created()) {
          let cut = key.indexOf(' ')
          let name = key.slice(0, cut), eid = key.slice(cut + 1)
          let row = host.component(eid, name)
          if (!row) continue
          full.set(key, {
            entity: { eid },
            $fleetWhole: name,
            [name]: Object.fromEntries(
              (vocab.comp(name)?.writable ?? []).filter((prop) => prop in row)
                .map((prop) => [prop, row[prop]]),
            ),
          })
        }
        return [...bundles, ...full.values()]
      },
    },
  }
  let g = graph({
    storage: bound,
    vocab,
    provenance: lifecycle.policy,
    plugins: [
      ...host.normalizers,
      lifecycle.capture,
      prepare,
      cas,
      fleetPreconditions(host.guards, bound, vocab),
      // Lifecycle commit needs the restored bodies and full creation rows.
      echoes,
      lifecycle.plugin,
    ],
  })
  let apply = g.apply
  // Keep the OUTER write lock: fleet normalizers read committed state before
  // core opens its own transaction. Replacing this with only Driver.tx would
  // reopen the read/upgrade race when the remaining policy plugins join.
  // No effect observers are registered in this phase: at the live-write flip,
  // effects must run AFTER this outer transaction, not just core's nested one.
  let write: FleetGraph['write'] = (changes, context, opts) => {
    try {
      return db.transaction(
        () =>
          lifecycle.run(context, opts, (options) => apply(changes, options)),
        true,
      )
    } catch (err) {
      auditFleetBounce(db, g, err)
      throw host.refusal(err)
    }
  }
  g.apply = (changes, opts) => write(changes, {}, opts)
  return Object.assign(g, { write })
}

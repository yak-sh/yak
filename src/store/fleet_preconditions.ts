// Fleet refusal policy composed over package hooks. Ordered checks share the
// live writer's SQL truths over the same transaction's already-written prefix.
import {
  actorOf,
  type Bundle,
  type Comp,
  dead,
  detached,
  type Graph,
  isPromise,
  type Plugin,
  type Tx,
} from '@yaks/graph'
import { Bounced as LeaseBounced, sessions } from '@yaks/session'
import { type Change, slugsOf } from '../types.ts'
import type { Sql, Statement } from './sql.ts'
import { asBundle, asChanges } from './wire.ts'

export let sync = <T>(value: T | Promise<T>): T => {
  if (isPromise(value)) {
    throw new Error('fleet preconditions must be synchronous')
  }
  return value
}

export type GuardHost = {
  db: Sql
  prepare: (sql: string) => Statement
  name: (eid: string) => string
  bounce: (err: LeaseBounced) => Error
  settle: (change: Change, row?: Comp) => Change | null
  before: (changes: Change[]) => void
  references: (changes: Change[]) => void
  after: (changes: Change[], created: string[]) => void
  check: (
    change: Change,
    changes: Change[],
    target?: string,
    actor?: string | null,
  ) => void
}

let lease = sessions()

// Use the package's lease rule on ONE ordered operation. The legacy fleet
// permits release then take in one batch; passing that entire batch to
// sessions() would intentionally retain its FOUND holder instead. No package
// fork is needed: the hook's Tx here reads the already-validated prefix.
export let checkFleetChange = (
  host: GuardHost,
  tx: Tx,
  change: Change,
  changes: Change[],
  target?: string,
  actor?: string | null,
): Change => {
  if (!host.db.inTransaction) throw new Error('fleet guard requires write lock')
  let { eid, name, comp } = change
  if (name == 'claim' && comp) {
    try {
      sync(lease.hooks!.precondition!([asBundle(change)], tx))
    } catch (err) {
      if (err instanceof LeaseBounced) throw host.bounce(err)
      throw err
    }
  }
  if (name == 'alias' && comp) {
    let cur = host.prepare(`select slug, slugs from alias
      where entity = (select id from entity where eid = ?)`).get<{
      slug: string
      slugs: string | null
    }>(eid)
    let slug = (comp.slug ?? cur?.slug ?? null) as string | null
    let slugs = (comp.slugs !== undefined ? comp.slugs : cur?.slugs) as
      | string
      | null
    let seen = new Set<string>()
    for (let s of slugsOf({ slug, slugs })) {
      if (seen.has(s)) throw new Error(`alias ${s} is listed twice`)
      seen.add(s)
      // Read members with the SAME whitespace semantics as admission and name
      // resolution, including tabs/newlines in historical rows.
      let owner = host.prepare(`select o.eid, a.slug, a.slugs from alias a
        join entity o on o.id = a.entity where o.eid != ?
          and (a.slug = ? or instr(a.slugs, ?) > 0)`).all<{
        eid: string
        slug: string
        slugs: string | null
      }>(eid, s, s).find((a) => slugsOf(a).includes(s))
      if (owner) {
        throw new Error(`alias ${s} already names ${host.name(owner.eid)}`)
      }
    }
  }
  host.check(change, changes, target, actor)
  return change
}

export let fleetPreconditions = (
  host: GuardHost,
): Plugin => ({
  name: 'fleet/preconditions',
  beforeWrite: (bundles) => {
    let changes = bundles.flatMap(asChanges)
    // A gathered existing component stays complete as patches fold into it.
    // A new/recreated row may acquire SQL defaults the gather cannot invent;
    // those keys must still settle against storage, not a partial echo.
    let fresh = new Set(
      bundles.flatMap((b) =>
        Object.keys(b.$fleetCreated ?? {}).map((name) =>
          `${name} ${b.entity.eid}`
        )
      ),
    )
    let actor = bundles.some((b) => b.$actor)
      ? actorOf(bundles).by ?? null
      : undefined
    return (bs, tx) => {
      let out: Bundle[] = []
      for (let b of bs) {
        let held = sync(tx.get([b.entity.eid]))[0]
        let cs = asChanges(b)
        for (let c of cs) {
          checkFleetChange(
            host,
            tx,
            c,
            changes,
            (b.$workClaim as { target?: string } | undefined)?.target,
            actor,
          )
        }
        if (!dead(b)) {
          let keep = { ...b }
          let changed = false
          for (let c of cs) {
            if (c.name == 'entity') continue
            // CAS has swapped the storage value; settle against hydrated
            // text, then retain only the storage columns that differ.
            let body = (b.$blob as Record<string, unknown> | undefined)
              ?.['doc.body']
            let logical = c.name == 'doc' && c.comp && body !== undefined
              ? { ...c, comp: { ...c.comp, body } }
              : c
            let row = held?.[c.name] as Comp | undefined
            // CAS mutation folds a storage reference into the prefix. Its
            // body comparison, unlike title-only edits, needs hydrated SQL.
            if (
              fresh.has(`${c.name} ${c.eid}`) ||
              (c.name == 'doc' && c.comp && 'body' in c.comp &&
                typeof row?.body != 'string')
            ) row = undefined
            let left = b.$fleetMaterialized
              ? logical
              : host.settle(logical, row)
            if (!left) {
              delete keep[c.name]
              continue
            }
            changed = true
            keep[c.name] = left.comp && c.comp
              ? Object.fromEntries(
                Object.keys(left.comp).map((col) => [col, c.comp![col]]),
              )
              : left.comp
            if (c.name == 'doc' && (!left.comp || !('body' in left.comp))) {
              delete keep.$blob
            }
          }
          if (changed || !cs.length) out.push(keep)
        } else out.push(b)
      }
      return out
    }
  },
  hooks: {
    precondition: (bundles) => {
      let changes = bundles.flatMap(asChanges)
      host.before(changes)
      host.references(changes)
      // Keep component order too: doc+comment is a create shape, while the
      // SQL prefix must still see decided before claim on the same bundle.
      return bundles.flatMap((b) => {
        let cs = asChanges(b).filter((c) =>
          c.name != 'entity' || c.comp == null
        )
        let meta = Object.fromEntries(
          Object.entries(b).filter(([k]) => k.startsWith('$')),
        )
        return cs.length
          ? cs.map((c) => ({
            ...meta,
            ...asBundle(c),
            entity: b.entity,
          })) as Bundle[]
          : [b]
      })
    },
    commit: (bundles) => {
      host.after(
        bundles.flatMap(asChanges),
        bundles.flatMap((b) =>
          Object.keys(b.$fleetCreated ?? {}).map((name) =>
            `${name} ${b.entity.eid}`
          )
        ),
      )
      return bundles
    },
  },
})

// The package audit writes only after the OUTERMOST transaction rolled back.
// Inner graph/apply invocations must leave that job to their caller.
export let auditFleetBounce = (db: Sql, graph: Graph, err: unknown) => {
  if (!(err instanceof LeaseBounced) || db.inTransaction) return
  try {
    let tx = detached(graph.storage)
    // Fleet conflict.target is NOT NULL. A target born in the refused batch
    // vanished on rollback; the old best-effort audit could not record that
    // collision either. Do not let generic storage invent a phantom target.
    if (!sync(tx.get([err.on])).some((b) => !b.tombstone)) return
    sync(lease.hooks!.audit!([], tx, err))
  } catch (audit) {
    console.warn('conflict audit failed —', audit)
  }
}

export let fleetGuardTx = (graph: Graph): Tx => detached(graph.storage)

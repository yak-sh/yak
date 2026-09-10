// Fleet normalization policy, registered on the composed graph and run under
// the existing outer immediate transaction. Core's
// normalize phase precedes its own transaction; detached reads alone are unsafe.
import { type Comp, type EditHost, edits, type Plugin } from '@yaks/graph'
import { Invalid, spec, validate } from '../config.ts'
import { shortId } from '../types.ts'
import type { Sql, Statement } from './sql.ts'

type Host = EditHost & { db: Sql; prepare: (sql: string) => Statement }

export let fleetNormalizers = (host: Host): Plugin[] => {
  let locked = () => {
    if (!host.db.inTransaction) {
      throw new Error('fleet normalize requires the outer write transaction')
    }
  }
  // One cadence clock per recipient: replace stored, untargeted, unacted
  // predecessors. Targeted reminders and delivered/error outcomes survive.
  let wakes: Plugin = {
    name: 'fleet/replace-wakes',
    hooks: {
      normalize: (bundles) => {
        locked()
        let exists = host.prepare(
          'select 1 from wake where entity = (select id from entity where eid = ?)',
        )
        let pending = host.prepare(`
          select o.eid as eid from wake w
          join entity o on o.id = w.entity
          join deliver dl on dl.entity = w.entity
          where dl."to" = (select id from entity where eid = ?)
            and w.target is null and o.eid != ?
            and not exists (select 1 from delivered d where d.entity = w.entity)
            and not exists (select 1 from error e where e.entity = w.entity)
        `)
        let toOf = new Map<string, string>()
        for (let b of bundles) {
          let to = (b.deliver as Comp | undefined)?.to
          if (typeof to == 'string') toOf.set(b.entity.eid, to)
        }
        return bundles.flatMap((b) => {
          let to = toOf.get(b.entity.eid)
          let wake = b.wake as Comp | null | undefined
          if (!wake || wake.target != null || !to || exists.get(b.entity.eid)) {
            return [b]
          }
          return [
            ...pending.all<{ eid: string }>(to, b.entity.eid).map((
              { eid },
            ) => ({
              entity: { eid },
              $delete: true,
            })),
            b,
          ]
        })
      },
    },
  }
  // Known, non-secret catalog keys only. Value-only patches read their key
  // from the stored row; canonical values are echoed as well as persisted.
  let settings: Plugin = {
    name: 'fleet/guard-settings',
    hooks: {
      normalize: (bundles) => {
        locked()
        let keyOf = host.prepare(
          'select key from setting where entity = (select id from entity where eid = ?)',
        )
        return bundles.map((b) => {
          let comp = b.setting as Comp | null | undefined
          if (!comp) return b
          let setsKey = 'key' in comp && comp.key != null
          let setsValue = 'value' in comp && comp.value != null
          if (!setsKey && !setsValue) return b
          let key = setsKey
            ? String(comp.key)
            : keyOf.get<{ key?: string }>(b.entity.eid)?.key
          if (!key) {
            throw new Invalid(
              `setting ${shortId(b.entity.eid)} names no catalog key`,
            )
          }
          if (setsValue) {
            return {
              ...b,
              setting: { ...comp, value: validate(key, String(comp.value)) },
            }
          }
          if (!spec(key) || spec(key)!.sensitive) {
            throw new Invalid(
              spec(key)
                ? `${key} is a secret and cannot be stored in the graph`
                : `unknown setting ${JSON.stringify(key)}`,
            )
          }
          return b
        })
      },
    },
  }
  let edit = edits(host)
  let normalize = edit.hooks!.normalize!
  edit.hooks!.normalize = (bundles, tx) => {
    locked()
    return normalize(bundles, tx)
  }
  return [edit, wakes, settings]
}

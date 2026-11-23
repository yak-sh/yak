// A Store's initial private SQLite bytes, shared by object and graph hosts.
import type { Insert } from '@yaks/sql'
import { val } from '@yaks/sql'
import { durable as raw } from '../../packages/durable-object/testing.ts'
import { imaged, type Snapshot } from '../../packages/sqlite/testing.ts'
import { GIT_STORE, PLATFORM_OBJECT } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { fitOf, KV, passed, shapeOf } from './store-schema.ts'
import { schema as writeSchema } from '@yaks/api/log'

// A new test object's installed schema is what a store's first wake leaves:
// the host's private tables, the write log, and the schema pass a wake runs
// (store-schema.ts `passed`), with the print it records, so its first wake
// finds the schema it stands at, as a store's next wake does. A component's
// table is raised by the write that first names it, as in production. Each
// durable() restores private bytes. The platform's two fixed names and an
// app's declaration are schema identity; no app name, actor, entity or
// lineage is copied.
let schemas = new Map<string, Snapshot>()
export let durable = (at = '', declaration: string | null = null) => {
  // The object the directory stands in holds the directory's words.
  let name = at == PLATFORM_OBJECT ? PLATFORM_STORE : at
  let shape = shapeOf(name, declaration)
  let key = JSON.stringify([shape.stamp, declaration, shape.own ? name : ''])
  let from = schemas.get(key)
  if (!from) {
    let values = {
      schema: shape.stamp,
      fitted: fitOf(null, shape.key, shape.stamp),
      ...(declaration ? { vocab: declaration } : {}),
    }
    if (name == PLATFORM_STORE || name == GIT_STORE) {
      Object.assign(values, { name })
    }
    from = imaged((d) => {
      for (let s of [KV, ...writeSchema()]) d.query(s)
      let { left } = passed(d, shape, null)
      if (left.length) throw left[0]
      d.query(
        {
          t: 'insert',
          into: KV.name,
          cols: ['k', 'v'],
          rows: Object.entries(values).map(([k, v]) => [val(k), val(v)]),
        } satisfies Insert,
      )
    })
    schemas.set(key, from)
  }
  return raw(from)
}

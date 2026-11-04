// A Store's initial private SQLite bytes, shared by object and graph hosts.
import type { Insert } from '@yaks/sql'
import { val } from '@yaks/sql'
import { triggers } from '@yaks/embedding'
import { durable as raw } from '../../packages/durable-object/testing.ts'
import { type Snapshot, snapshot } from '../../packages/sqlite/testing.ts'
import { GIT_STORE, PLATFORM_OBJECT, PLATFORM_STORE } from './door.ts'
import { KV, shapeOf } from './store-schema.ts'
import { schema as writeSchema } from './writes.ts'
import { texts } from './embedding.ts'

// A new test object's installed schema is the production shape, including the
// host's private tables and embedding queue triggers. Each durable() restores
// private bytes. The platform's two fixed names and an app's declaration are
// schema identity; no app name, actor, entity or lineage is copied.
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
      ...(declaration ? { vocab: declaration } : {}),
    }
    if (name == PLATFORM_STORE || name == GIT_STORE) {
      Object.assign(values, { name })
    }
    from = snapshot(shape.vocab, { derived: shape.derived }, [
      KV,
      ...shape.ddl,
      ...writeSchema(),
      ...triggers(texts(shape.vocab, shape.derived)),
      ...Object.entries(values).map(([k, v]): Insert => ({
        t: 'insert',
        into: KV.name,
        cols: ['k', 'v'],
        rows: [[val(k), val(v)]],
      })),
    ])
    schemas.set(key, from)
  }
  return raw(from)
}

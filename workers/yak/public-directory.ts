// The public directory's serving copy (index.ts `PublicDirectory`), one
// object beside the directory that holds what it last published.
import { DurableObject } from 'cloudflare:workers'
import type { DurableStorage } from '@yaks/durable-object'
import type { Env } from './env.ts'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'

// Independent of yak/platform: only a missed directory deadline reads here.
export class PublicDirectoryStore extends DurableObject<Env> {
  #copy: ServingCopy
  constructor(
    ctx:
      & ConstructorParameters<typeof DurableObject>[0]
      & { storage: DurableStorage },
    env: Env,
  ) {
    super(ctx, env)
    this.#copy = new ServingCopy({
      persistence: {
        read: () => {
          ctx.storage.sql.exec(
            'CREATE TABLE IF NOT EXISTS copy (id INTEGER PRIMARY KEY, body TEXT)',
          )
          let [row] = ctx.storage.sql.exec(
            'SELECT body FROM copy WHERE id = 1',
          ).toArray() as { body: string }[]
          if (!row) return undefined
          // A row saved before the ceiling holds the last fence granted.
          let saved = JSON.parse(row.body) as
            | ServingCopyState
            | { revision: number }
          return 'ceiling' in saved ? saved : { ceiling: saved.revision }
        },
        write: (state) => {
          ctx.storage.sql.exec(
            'INSERT OR REPLACE INTO copy (id, body) VALUES (1, ?)',
            JSON.stringify(state),
          )
        },
      },
    })
  }
  valid(revision: number) {
    return this.#copy.valid(revision)
  }
  publish(revision: number, key: string, body: string) {
    return this.#copy.publish(revision, key, body)
  }
  publishes(answers: [number, string, string][]) {
    return this.#copy.publishes(answers)
  }
  read(key: string) {
    try {
      return this.#copy.read(key)
    } catch (e) {
      if (e instanceof ServingCopyUnavailable) return null
      throw e
    }
  }
  begin(committed?: number) {
    return this.#copy.begin(committed)
  }
  revision() {
    return this.#copy.revision
  }
  finish(revision: number) {
    return this.#copy.finish(revision)
  }
  settle(revision: number, committed: number) {
    return this.#copy.settle(revision, committed)
  }
  put(revision: number, key: string, body: string) {
    return this.#copy.put(revision, key, body)
  }
  get(key: string) {
    try {
      return this.#copy.get(key)
    } catch (e) {
      if (e instanceof ServingCopyUnavailable) return null
      throw e
    }
  }
}

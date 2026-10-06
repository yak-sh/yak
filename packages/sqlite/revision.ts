// Connection-local invalidation for physical schema and archetype snapshots.
// Single-owner drivers prove nothing by SQL between mutations: every statement
// already passes through query/run. File drivers additionally observe other
// connections through SQLite's version pragmas. Rollback invalidates rather
// than rewinding a counter, since a snapshot may have been taken inside the
// transaction whose changes just disappeared.
import type { Driver, Stmt } from '@yaks/sql'

let held = new WeakMap<Driver, {
  schema: number
  catalog: number
  data: number
  schemaVersion?: unknown
  dataVersion?: unknown
}>()

type Scope = 'schema' | 'catalog' | 'data'

/** A monotonic invalidation token, not a stored row or catalog fingerprint. */
export function revision(driver: Driver, scope: Scope): number {
  let state = held.get(driver)
  if (!state) {
    state = { schema: 0, catalog: 0, data: 0 }
    held.set(driver, state)
    let current = state
    let invalidate = () => {
      current.schema++
      current.catalog++
      current.data++
    }
    let scopes: {
      name?: string
      schema: number
      catalog: number
      data: number
    }[] = []
    let undo = (at: { schema: number; catalog: number; data: number }) => {
      if (current.schema != at.schema) current.schema++
      if (current.catalog != at.catalog) current.catalog++
      if (current.data != at.data) current.data++
    }
    let observe = (s: Stmt): void => {
      if (s.t == 'raw') {
        if (s.origin) observe(s.origin)
        return
      }
      if (s.t == 'insert' || s.t == 'update' || s.t == 'delete') current.data++
      if (s.t == 'begin' || s.t == 'savepoint') {
        scopes.push({
          ...current,
          name: s.t == 'savepoint' ? s.name : undefined,
        })
      } else if (s.t == 'rollback') {
        let at = s.to ? scopes.findLastIndex((v) => v.name == s.to) : 0
        let was = scopes[at]
        if (was) undo(was)
        else invalidate()
        scopes.splice(s.to ? at + 1 : 0)
      } else if (s.t == 'commit') scopes = []
      else if (s.t == 'release') {
        let at = scopes.findLastIndex((v) => v.name == s.name)
        if (at >= 0) scopes.splice(at)
      } else if (
        s.t.startsWith('create ') || s.t == 'alter table' || s.t == 'drop'
      ) invalidate()
      else if (
        s.t == 'insert' && s.into == 'archetype' ||
        s.t == 'delete' && (s.from == 'archetype' || s.from == 'entity') ||
        s.t == 'update' && (s.table == 'archetype' || s.table == 'entity') ||
        s.t == 'insert' && s.into == 'entity'
      ) current.catalog++
    }
    let query = driver.query.bind(driver)
    driver.query = (s) => {
      observe(s)
      return query(s)
    }
    if (driver.run) {
      let run = driver.run.bind(driver)
      driver.run = (s) => {
        observe(s)
        return run(s)
      }
    }
    if (driver.tx) {
      let tx = driver.tx.bind(driver)
      driver.tx = (body) => {
        let was = { ...current }
        try {
          let out = tx(body)
          return out instanceof Promise
            ? out.catch((error) => {
              undo(was)
              throw error
            }) as typeof out
            : out
        } catch (error) {
          undo(was)
          throw error
        }
      }
    }
    if (driver.template) {
      let template = driver.template.bind(driver)
      driver.template = (key, make) => {
        invalidate()
        template(key, make)
      }
    }
  }
  if (driver.file) {
    let schemaVersion = driver.query({ t: 'pragma', name: 'schema_version' })[0]
      ?.schema_version
    if (schemaVersion !== state.schemaVersion) {
      state.schemaVersion = schemaVersion
      state.schema++
      state.catalog++
      state.data++
    }
    if (scope == 'catalog' || scope == 'data') {
      let dataVersion = driver.query({ t: 'pragma', name: 'data_version' })[0]
        ?.data_version
      if (dataVersion !== state.dataVersion) {
        state.dataVersion = dataVersion
        state.catalog++
        state.data++
      }
    }
  }
  return state[scope]
}

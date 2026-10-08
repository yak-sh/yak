// Connection-local invalidation for physical schema and archetype snapshots.
// Single-owner drivers prove nothing by SQL between mutations: every statement
// already passes through query/run. File drivers additionally observe other
// connections through SQLite's version pragmas, once per transaction: the
// pragmas themselves open its snapshot, and no other connection's commit is
// seen inside one, so asking again before it ends could only answer the same.
// Rollback invalidates rather than rewinding a counter, since a snapshot may
// have been taken inside the transaction whose changes just disappeared.
import type { Driver } from './driver.ts'
import type { Stmt } from './ast.ts'

type Tokens = {
  schema: number
  catalog: number
  data: number
  descriptors: number
}
type State = Tokens & {
  outside: number
  schemaVersion?: unknown
  dataVersion?: unknown
  /** where each open transaction and savepoint began */
  scopes: (Tokens & { name?: string })[]
  /** which version pragmas the open transaction has read */
  seen: { schema: boolean; data: boolean }
}

// By connection (`Driver.connection`), and the drivers already speaking into
// each one's state.
let held = new WeakMap<object, State>()
let wrapped = new WeakSet<Driver>()

// `outside` moves only for what this connection's statements cannot say:
// another connection's commit, a loaded library, a template, and DDL.
type Scope = 'schema' | 'catalog' | 'data' | 'descriptors' | 'outside'

/** A monotonic invalidation token, not a stored row or catalog fingerprint. */
export function revision(driver: Driver, scope: Scope): number {
  let at = driver.connection ?? driver
  let state = held.get(at)
  if (!state) {
    state = {
      schema: 0,
      catalog: 0,
      data: 0,
      descriptors: 0,
      outside: 0,
      scopes: [],
      seen: { schema: false, data: false },
    }
    held.set(at, state)
  }
  if (!wrapped.has(driver)) {
    wrapped.add(driver)
    let current = state
    let invalidate = () => {
      current.schema++
      current.catalog++
      current.data++
      current.descriptors++
      current.outside++
    }
    let undo = (at: Tokens) => {
      if (current.schema != at.schema) current.schema++
      if (current.catalog != at.catalog) current.catalog++
      if (current.data != at.data) current.data++
      if (current.descriptors != at.descriptors) current.descriptors++
    }
    let observe = (s: Stmt): void => {
      // A raw statement is SQL this package wrote: a rendered one keeps the
      // statement it came from, and one without is a query the compiler
      // lowered to text (the death cascade's closure), which moves nothing.
      if (s.t == 'raw') {
        if (s.origin) observe(s.origin)
        return
      }
      if (s.t == 'insert' || s.t == 'update' || s.t == 'delete') current.data++
      if (
        s.t == 'insert' && s.into == 'archetype' ||
        s.t == 'update' && s.table == 'archetype' ||
        s.t == 'delete' && (s.from == 'archetype' || s.from == 'entity')
      ) current.descriptors++
      let { scopes } = current
      if (s.t == 'begin' || s.t == 'savepoint') {
        let { schema, catalog, data, descriptors } = current
        scopes.push({
          schema,
          catalog,
          data,
          descriptors,
          name: s.t == 'savepoint' ? s.name : undefined,
        })
      } else if (s.t == 'rollback') {
        let at = s.to ? scopes.findLastIndex((v) => v.name == s.to) : 0
        let was = scopes[at]
        if (was) undo(was)
        else invalidate()
        scopes.splice(s.to ? at + 1 : 0)
      } else if (s.t == 'commit') scopes.length = 0
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
      // A transaction's snapshot ends with it, and `begin` always opens one.
      if (!scopes.length || s.t == 'begin') {
        current.seen.schema = current.seen.data = false
      }
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
    if (driver.extension) {
      let extension = driver.extension.bind(driver)
      driver.extension = (path) => {
        // Loading a library can create its metadata tables outside query/run.
        invalidate()
        extension(path)
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
    let inside = state.scopes.length > 0
    if (!(inside && state.seen.schema)) {
      let schemaVersion = driver.query({ t: 'pragma', name: 'schema_version' })[
        0
      ]?.schema_version
      if (schemaVersion !== state.schemaVersion) {
        state.schemaVersion = schemaVersion
        state.schema++
        state.catalog++
        state.data++
        state.descriptors++
        state.outside++
      }
      if (inside) state.seen.schema = true
    }
    if (scope != 'schema' && !(inside && state.seen.data)) {
      let dataVersion = driver.query({ t: 'pragma', name: 'data_version' })[0]
        ?.data_version
      if (dataVersion !== state.dataVersion) {
        state.dataVersion = dataVersion
        state.catalog++
        state.data++
        state.descriptors++
        state.outside++
      }
      if (inside) state.seen.data = true
    }
  }
  return state[scope]
}

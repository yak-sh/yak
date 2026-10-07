// SQL-backed storage's statement capability. The connection and native
// libraries stay here; indexes receive only statements and coherent units.
import { type Driver, revision, type Statements } from '@yaks/sql'
import { unit } from './unit.ts'

let held = new WeakMap<Driver, Statements>()
let platform =
  (globalThis as { Deno?: { build: { os: string; arch: string } } }).Deno?.build
let vectorPath = (): string | undefined => {
  let names: Record<string, string> = {
    'linux-x86_64': '@sqlite-vector-linux-x86_64',
    'linux-aarch64': '@sqlite-vector-linux-aarch64',
    'darwin-x86_64': '@sqlite-vector-darwin-x86_64',
    'darwin-aarch64': '@sqlite-vector-darwin-aarch64',
    'windows-x86_64': '@sqlite-vector-windows-x86_64',
  }
  let name = platform && names[`${platform.os}-${platform.arch}`]
  if (!name || !platform) return
  let ext = platform.os == 'windows'
    ? 'dll'
    : platform.os == 'darwin'
    ? 'dylib'
    : 'so'
  return new URL(`./vector.${ext}`, import.meta.resolve(name)).pathname
}

/** One stable capability per connection, sharing the graph's transaction. */
export let statements = (driver: Driver): Statements => {
  let found = held.get(driver)
  if (found) return found
  // Observe before lending any statements: wrappers must not bypass revision.
  revision(driver, 'schema')
  let vector = driver.extension && vectorPath()
  let made: Statements = {
    query: (s) => {
      if (
        ['begin', 'commit', 'rollback', 'savepoint', 'release'].includes(s.t)
      ) {
        throw new Error('storage owns transactions; use statements.atomic')
      }
      return driver.query(s)
    },
    ownership: driver.file ? 'shared' : 'exclusive',
    arms: driver.arms,
    revision: (scope) => revision(driver, scope),
    atomic: (body) => unit(driver, body),
    ...vector
      ? { facilities: { vector: () => driver.extension!(vector) } }
      : {},
  }
  held.set(driver, made)
  return made
}

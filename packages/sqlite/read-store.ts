// The capabilities an installed store lends a read-only host.
import { type BindOpts, type Driver, revision, worn } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { Refused } from '@yaks/graph/errors'
import type { Store } from './mod.ts'
import { grown, indexed, standing, tabled } from './ddl.ts'
import { checks } from './check.ts'
import { migrations } from './migration.ts'
import { statements } from './statements.ts'
import { screened } from './read.ts'
import { options, reader } from './reader.ts'
import { unit } from './unit.ts'
import { plan } from './plan.ts'

/** Bind every committed-store capability without admitting write callbacks.
 * Index plugins receive the same statement, revision and schema descriptions
 * as a writable store; the database driver enforces statement read-onlyness. */
export let storage = (
  driver: Driver,
  vocab: Vocab,
  base: BindOpts = {},
): Store => {
  let opts = options(driver, vocab, base)
  let sql = statements(driver)
  let refuse = (): never => {
    throw new Refused('a read-only store cannot write')
  }
  return {
    ...reader(driver, vocab, base),
    statements: {
      ...sql,
      atomic: (body) => unit(driver, body, 'read'),
      ...vocab.comp('archetype') ? { archetypes: true } : {},
    },
    checks: checks(driver),
    migrations: migrations(driver),
    revision: () => revision(driver, 'data'),
    worn: worn(vocab, base.derived),
    ddl: () => [
      ...tabled(vocab, base.derived, !!driver.file),
      ...grown(vocab, standing(driver, vocab)),
      ...indexed(vocab),
    ],
    grown: () => grown(vocab, standing(driver, vocab)),
    print: () => plan(vocab, base.derived, !!driver.file).print,
    screen: (q, o) => screened(driver, vocab, q, { ...opts(), ...o }),
    install: refuse,
    analyze: refuse,
    tx: refuse,
  }
}

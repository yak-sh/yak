// A REPL's cells, between the host that keeps the REPL and the cell's own
// Worker. Nothing can evaluate new code into a running isolate, so each cell
// is a Worker of its own, run as the same Durable Object facet: its storage
// (`storage.sql`, `storage.kv`) lasts as long as the REPL, and the cell's
// top-level values are kept there when it ends (./source.ts `keep`). The host
// keeps what this module needs to declare them again in the next cell: the
// names kept, and the source of each function and class declared.
import { type Declared, declared } from './scan.ts'
import { CARRIED } from './source.ts'

/** What a REPL carries from one cell to the next, kept by its host. */
export type Carried = {
  /** the names whose values the facet's storage holds */
  values: string[]
  /** each function and class declared, by name */
  declarations: Record<string, string>
}

export let EMPTY: Carried = { values: [], declarations: {} }

let CELL = 'cell.json'
let id = (name: string) => JSON.stringify(name)

/** What a cell's own code declares, kept beside it for `carry` and `settle`. */
export let cellOf = (modules: Record<string, string>): Declared =>
  JSON.parse(modules[CELL] ?? '{"names":[],"declarations":{}}')

/** The cell's modules with `declared`'s reading of its code beside them. */
export let described = (
  modules: Record<string, string>,
): Record<string, string> => {
  let user = modules['user.js']
  let code = user.slice(user.indexOf(CARRIED) + CARRIED.length)
  return { ...modules, [CELL]: JSON.stringify(declared(code)) }
}

/** The cell's modules as its Worker loads them, declaring first what the
 * REPL carries and the cell does not declare again: each kept value by its name, then each earlier
 * function and class. Its own names and the carried ones are read back when
 * it ends, whichever were bound. */
export let carry = (
  modules: Record<string, string>,
  carried: Carried,
): Record<string, string> => {
  let cell = cellOf(modules)
  let own = new Set([...cell.names, ...Object.keys(cell.declarations)])
  let values = carried.values.filter((name) => !own.has(name))
  let declarations = Object.entries(carried.declarations)
    .filter(([name]) => !own.has(name))
  let read = [...new Set([...cell.names, ...values])]
  let prelude = [
    `function $capture() {\n  const $o = {};\n${
      read.map((name) => `  try { $o[${id(name)}] = ${name}; } catch {}`)
        .join('\n')
    }\n  return $o;\n}`,
    '$carried.capture = $capture;',
    ...values.map((name) => `let ${name} = $carried.values[${id(name)}];`),
    ...declarations.map(([, source]) => source),
  ].join('\n')
  // What the cell declares is the host's to read, not a module to load.
  let { [CELL]: _, ...loaded } = modules
  return {
    ...loaded,
    'user.js': modules['user.js'].replace(CARRIED, () => prelude),
  }
}

/** What the REPL carries after a cell, and the cell's answer without its
 * bookkeeping. A name the cell bound again as a value is no longer a
 * declaration, and one it declared is no longer a value. */
export let settle = (
  carried: Carried,
  modules: Record<string, string>,
  text: string,
): { carried: Carried; text: string } => {
  let { $kept, ...answer } = JSON.parse(text) as {
    $kept?: string[]
    [k: string]: unknown
  }
  if (!$kept) return { carried, text }
  let cell = cellOf(modules)
  let declarations = { ...carried.declarations }
  for (let name of $kept) delete declarations[name]
  Object.assign(declarations, cell.declarations)
  return {
    carried: {
      values: $kept.filter((name) => !(name in cell.declarations)),
      declarations,
    },
    text: JSON.stringify(answer),
  }
}

/** Where a host keeps what its REPL carries. */
export type Keeping = {
  read(): Carried | undefined
  write(carried: Carried): void
}

/** How a REPL's host runs each cell: declared with what the REPL carries,
 * run by `run` as the REPL's facet, and settled into what it carries next. */
export let cells = (
  kept: Keeping,
  run: (modules: Record<string, string>) => Promise<string>,
) =>
async (modules: Record<string, string>): Promise<string> => {
  let carried = kept.read() ?? EMPTY
  let text = await run(carry(modules, carried))
  let settled = settle(carried, modules, text)
  kept.write(settled.carried)
  return settled.text
}

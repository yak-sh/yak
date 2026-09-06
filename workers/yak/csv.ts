// A spreadsheet as rows of one component (T-34393). Most of the bulk data a
// person already has is a `.csv` — an export from a spreadsheet, a table off
// the web — and nothing about it says which entity a row is or what its
// columns mean. So the caller says it once: `store_load(app, path, as)` names
// the component each ROW becomes, and the header row names the columns.
//
// The default mapping is the obvious one and needs no argument: a header lands
// in the same-named column of `as`, coerced to that column's type; `title` and
// `body` land in `doc`, because a row a person reads has words; an `id` (or
// `alias`) column is the row's NAME — `alias{name}` (@yaks/alias), which lands
// on the entity already holding it, so loading the file again PATCHES the same
// rows instead of minting a second set, and the name stands wherever an eid
// does. `map {header: column}` renames a header that does not match — it
// renames, it does not re-route, so a mapped name resolves by the same three
// rules.
//
// A component's own columns win over all of it: if the app declared
// `city.title`, a `title` header is that column and not the doc's.
//
// Everything a spreadsheet gets wrong is refused in the file's own words, with
// the row and the header in the sentence — a cell nobody can find is a cell
// nobody can fix. The parsing itself is @std/csv's (quotes, embedded commas
// and newlines, CRLF); this file is only the mapping.
import { parse } from '@std/csv'
import type { Bundle } from '@yaks/graph'
import type { Sown } from './seed.ts'

/** A component's columns, as the type each takes: the five-scalar short form a
 * store answers its own words in (vocab.ts `shortOf`). */
export type Cols = Record<string, string>

/** What a CSV is read AS: the component every row wears, that component's
 * columns, and any header the caller renamed. */
export type Sheet = { as: string; cols: Cols; map?: Record<string, string> }

let SHAPE = 'a CSV is a header row naming the columns, then one row per ' +
  'entity — name,serves / Lentil soup,4'

/** The headers that name the row itself rather than a column of it. */
let NAMES = ['id', 'alias']
/** The headers that land in `doc`, the words a person reads. */
let DOC = ['title', 'body']

/** The words a `bool` cell may be written with, either way round. */
let YES = ['true', 'yes', '1']
let NO = ['false', 'no', '0']

// One cell as its column's type. `undefined` means it will not coerce, which
// the caller turns into a refusal naming the row and the header — this has no
// idea which row it is looking at.
let value = (type: string, cell: string): unknown => {
  let said = cell.trim()
  if (type == 'number') {
    let n = Number(said)
    return Number.isFinite(n) ? n : undefined
  }
  if (type == 'bool') {
    let word = said.toLowerCase()
    return YES.includes(word) ? true : NO.includes(word) ? false : undefined
  }
  // text, time and url are stored as they were written: a store keeps them as
  // text, and a date this cannot parse is a date the person meant.
  return cell
}

/** Where one header's values go: a column of a component, or the row's own
 * name. */
type Lands = { comp: string; col: string; type: string } | { named: true }

// WHICH, by the three rules — the component's own columns first, so an app
// that declared `city.id` means that column and not the row's name.
let landing = (file: string, spec: Sheet, header: string): Lands => {
  let name = spec.map?.[header] ?? header
  if (name in spec.cols) {
    return { comp: spec.as, col: name, type: spec.cols[name] }
  }
  if (NAMES.includes(name)) return { named: true }
  if (DOC.includes(name)) return { comp: 'doc', col: name, type: 'text' }
  throw new Error(
    `${file}: ${JSON.stringify(header)}${
      name == header ? '' : ` maps to ${JSON.stringify(name)}, which`
    } is not a column of ${spec.as} — ${spec.as} takes ${
      Object.keys(spec.cols).join(', ') || 'no columns'
    }, and title, body and id land where they always do; map it with map ` +
      `{${JSON.stringify(header)}: "<column>"} or declare it in vocab.json`,
  )
}

/**
 * One CSV file's bundles, in the file's own order, remembering where each row
 * was written so a refused batch names it (seed.ts `at`). Every refusal here
 * is the file's: the header that names nothing, the cell that will not coerce,
 * the row with more values than there are columns.
 */
export let sheet = (file: string, text: string, spec?: Sheet): Sown[] => {
  if (!spec) {
    throw new Error(
      `${file} is a CSV: say which component a row becomes — ` +
        "store_load(as: 'city'), and the headers are its columns",
    )
  }
  let rows: string[][]
  try {
    // The BOM a spreadsheet writes is not part of the first header's name.
    rows = parse(text.replace(/^\uFEFF/, ''))
  } catch (e) {
    throw new Error(`${file} is not a CSV: ${(e as Error).message} — ${SHAPE}`)
  }
  let [head, ...body] = rows
  if (!head) throw new Error(`${file} is empty — ${SHAPE}`)
  let headers = head.map((h) => h.trim())
  headers.forEach((h, i) => {
    if (!h) throw new Error(`${file}: column ${i + 1} has no header — ${SHAPE}`)
  })
  let lands = headers.map((h) => landing(file, spec, h))
  return body.map((cells, index) => {
    let where = `${file}[${index}]`
    if (cells.length > headers.length) {
      throw new Error(
        `${where} has ${cells.length} values for ${headers.length} ${
          headers.length == 1 ? 'header' : 'headers'
        }`,
      )
    }
    // The component is written even when the row said nothing about it: `as`
    // is what the row IS, and a bare component says that much on its own.
    let parts: Record<string, Record<string, unknown>> = { [spec.as]: {} }
    let name = ''
    cells.forEach((cell, i) => {
      if (cell.trim() == '') return // an empty cell is unsaid, never null
      let to = lands[i]
      if ('named' in to) return void (name = cell.trim())
      let got = value(to.type, cell)
      if (got === undefined) {
        throw new Error(
          `${where}: ${headers[i]} is ${
            JSON.stringify(cell)
          }, not a ${to.type}`,
        )
      }
      parts[to.comp] = { ...parts[to.comp], [to.col]: got }
    })
    return {
      file,
      index,
      // The row is always minted for the batch (`$…`, @yaks/graph). What makes
      // a second load a PATCH is the id column, said as the row's own name:
      // `alias{name}` lands on the entity already holding it (@yaks/alias). No
      // id column, or an empty one, and every load mints a new entity.
      bundle: {
        entity: { eid: `$${file}:${index}` },
        ...(name ? { alias: { name } } : {}),
        ...parts,
      } as Bundle,
    }
  })
}

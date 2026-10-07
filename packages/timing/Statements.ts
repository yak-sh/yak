/** The statements a span or a place ran: each statement, then under it how
 * many times it ran and the rows and time it took, in columns that line up
 * (./layout.ts). Drawn through the host's hyperscript, so a span's page
 * and a trace's places draw them alike, and a terminal reads the lines a
 * browser does.
 * @module
 */
import type { H } from '@yaks/render'
import type { Ran } from './ran.ts'
import { figure } from './readings.ts'
import { figures, heading, line, list, name, number, quiet } from './layout.ts'

let columns = ['×', 'rows read', 'rows written', 'ms']
// A statement is long: it takes its line, and its figures stand under it.
let text = { ...name(0), flexBasis: '100%' }

/** Lines for `ran` under a line naming their columns. */
export let statements = <Node>(h: H<Node>, ran: Ran[]): Node => {
  let cells = (said: string[], style: object) =>
    h(
      'span',
      { style: figures },
      said.map((c, i) => [i ? ' ' : '', h('span', { style }, c)]),
    )
  return h(
    'ul',
    { style: list, 'data-statements': '' },
    h(
      'li',
      { style: { ...line, ...heading } },
      h('span', { style: name(0) }, 'statement'),
      ' ',
      cells(columns, { ...number, color: 'inherit' }),
    ),
    ran.map((r) =>
      h(
        'li',
        { style: line },
        r.sql == null
          ? h('span', { style: { ...text, ...quiet } }, 'other statements')
          : h('code', { style: text }, r.sql),
        ' ',
        cells([
          figure('statements', r.n),
          figure('rows_read', r.rows_read),
          figure('rows_written', r.rows_written),
          figure('elapsed', r.ms),
        ], number),
      )
    ),
  )
}

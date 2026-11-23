// A rule instruction sent where a query is answered. `$x`, `+comp`, `*comp`,
// `-comp` and `#Name` say what a rule does with what it matched, and only a
// rule engine reads them (rule.ts `declared`); an evaluator answering a query
// refuses one, and says here what it is and what a query writes instead.

import type { Clause } from './ast.ts'
import { stringify } from './stringify.ts'

/**
 * What a rule instruction is, said to someone who sent it as a query, and the
 * filter a query writes instead; undefined for a clause that is no
 * instruction.
 *
 * ```ts
 * import { instruction, parse } from '@yaks/query/core'
 * import { equal } from '@yaks/testing'
 *
 * equal(instruction(parse('$total').clauses[0]),
 *   '$total is a rule variable, which only a rule or a template binds; ' +
 *     'a query names the value itself, as .order.total=5')
 * equal(instruction(parse('+!seen').clauses[0]),
 *   '+!seen is a rule instruction, which only a rule acts on; ' +
 *     'a query matches rows without it as !seen')
 * equal(instruction(parse('*task.status=done').clauses[0]),
 *   '*task.status=done is a rule instruction, which only a rule acts on; ' +
 *     'a query matches rows holding it as .task.status=done')
 * equal(instruction(parse('.doc').clauses[0]), undefined)
 * ```
 */
export let instruction = (c: Clause): string | undefined => {
  let said = stringify(c)
  let rule = `${said} is a rule instruction, which only a rule acts on; `
  switch (c.kind) {
    case 'var':
      return `${said} is a rule variable, which only a rule or a template ` +
        'binds; a query names the value itself, as .order.total=5'
    case 'ensure':
    case 'mutable':
      return rule + `a query matches rows holding it as .${said.slice(1)}`
    case 'gate':
      return rule + `a query matches rows without it as !${c.comp}`
    case 'gone':
      return rule + 'it matches a removal as a write commits; a query ' +
        `matches rows without it as !${c.comp}`
    case 'resource':
      return rule + `a query reads the row as .${c.comp}`
  }
}

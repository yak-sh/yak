// A query the graph keeps (a board's, a builder's, a rule's match): resolved
// in its writer's namespace and stored with identities, so a rename of any
// word it names leaves it meaning what it meant, and nothing rewrites it. Each
// reader gets it back written in its own labels.
//
// A name is read where it stands in its path: a component, then one of its
// properties, then past a reference another component, or past a reverse
// association a property of the component it reaches. A name the vocabulary
// gives no identity (a reverse association, a relation, the spine's eid, a
// word with no `$id` yet) is kept as written.

import type { Vocab } from '@yaks/vocab'
import type { Clause } from './ast.ts'
import { parse } from './parse.ts'
import { stringify } from './stringify.ts'

// A path turned name by name, from the component whose property may come
// first (a reverse test's child, past its association): the names, and the
// component the path ends on.
type Turn = (path: string[], from?: string) => [string[], string?]

// The clauses with every path turned. Unturned, a clause is itself.
let turned = (c: Clause, turn: Turn, from?: string): Clause => {
  let one = (path: string[]) => turn(path, from)[0]
  switch (c.kind) {
    case 'and':
    case 'or':
      return { ...c, clauses: c.clauses.map((x) => turned(x, turn, from)) }
    case 'pred': {
      let [path, at] = turn(c.path, from)
      return {
        ...c,
        path,
        ...c.where ? { where: turned(c.where, turn, at) } : {},
      }
    }
    case 'walk':
    case 'distinct':
    case 'tally':
      return { ...c, path: one(c.path) }
    case 'fields':
      return {
        ...c,
        fields: c.fields.map((f) => ({ ...f, path: one(f.path) })),
      }
    case 'order': {
      let down = c.value.startsWith('-') ? '-' : ''
      let path = one(c.value.slice(down.length).split('.'))
      return { ...c, value: down + path.join('.') }
    }
    case 'ensure':
    case 'mutable': {
      let [comp, prop] = one(c.prop ? [c.comp, c.prop] : [c.comp])
      return { ...c, comp, ...prop ? { prop } : {} }
    }
    case 'gate':
    case 'resource':
    case 'gone':
      return { ...c, comp: one([c.comp])[0] }
    default:
      return c
  }
}

let rewritten = (q: string, turn: Turn): string => {
  let tree = parse(q)
  let out = turned(tree, turn)
  return JSON.stringify(out) == JSON.stringify(tree) ? q : stringify(out)
}

/**
 * A query as the graph keeps it: every component, property and kind it names
 * written as its identity, read as `v`'s reader reads it (`Vocab.in`). A bare
 * label that means several words is refused (`Ambiguous`), naming the full
 * labels to write instead.
 *
 * ```ts
 * import { identified, labeled } from '@yaks/query'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let [NS, TRIP, EUROS] = [1, 2, 3].map(() => crypto.randomUUID())
 * let v = loadVocab({
 *   $id: `urn:uuid:${NS}`,
 *   label: 'yourname/trip',
 *   $defs: {
 *     cost: {
 *       $id: `urn:uuid:${TRIP}`,
 *       component: true,
 *       properties: { euros: { $id: `urn:uuid:${EUROS}`, type: 'number' } },
 *     },
 *   },
 * })
 * let kept = identified('.cost.euros>10 .order=-cost.euros', v)
 * equal(kept, `.${TRIP}.${EUROS}>10&.order=-${TRIP}.${EUROS}`)
 * equal(labeled(kept, v), '.cost.euros>10&.order=-cost.euros')
 * ```
 */
export let identified = (q: string, v: Vocab): string =>
  rewritten(q, (path, from) => {
    let out: string[] = []
    let at = from
    for (let name of path) {
      let p = at ? v.prop(at, name) : undefined
      let assoc = !p && v.assoc(name)
      let comp = !p && !assoc ? v.held(name) : undefined
      out.push(
        p
          ? p.id ?? name
          : comp
          ? v.comp(comp)?.id ?? name
          : assoc
          ? name
          : v.kind(name)?.id ?? name,
      )
      at = assoc ? assoc.comp : comp
    }
    return [out, at]
  })

/**
 * A kept query written in a reader's labels: each identity as the name `v`'s
 * reader writes its word by, bare where that reads back to it and in full
 * otherwise. Every other name is kept as written.
 */
export let labeled = (q: string, v: Vocab): string =>
  rewritten(q, (path) => [
    path.map((name) => {
      let w = v.word(name)
      return !w ? name : 'kind' in w ? w.kind : w.prop ?? w.comp
    }),
  ])

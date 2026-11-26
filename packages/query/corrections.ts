import type { Vocab } from '@yaks/vocab'
import { and, type Clause, compares, type Pred, present } from './ast.ts'
import { parse } from './parse.ts'
import { stringify } from './stringify.ts'

let alternatives = (vocab: Vocab, path: string): string[][] => {
  let [first, second, ...rest] = path.split('.')
  if (rest.length) return []
  if (second == null) {
    return vocab.comp(first) || vocab.kind(first) || vocab.assoc(first)
      ? []
      : vocab.all.filter((c) => vocab.prop(c, first)).map((c) => [c, first])
  }
  if (!vocab.comp(first) || !vocab.comp(second) || vocab.prop(first, second)) {
    return []
  }
  // A reference to a different component can put it on a different entity.
  if (
    first != second &&
    vocab.props(first).some((p) => vocab.prop(first, p)?.ref == second)
  ) {
    return []
  }
  return [[second]]
}

let beside = (vocab: Vocab, c: Pred, comp: string): Clause => {
  let path = [comp]
  if (compares(c)) {
    let props = vocab.props(comp).filter((p) => {
      let scalar = vocab.prop(comp, p)?.scalar
      return scalar && scalar != 'jsonb' && scalar != 'binary'
    })
    if (props.length != 1) return c
    path.push(props[0])
  }
  let next = { ...c, path }
  return c.path[0] == comp ? next : and(present(c.path[0]), next)
}

/** Rewrite a refused predicate while keeping its value and the surrounding
 * query. Each possible owner of a bare property gets its own suggestion. */
export let corrections = (
  vocab: Vocab,
  line: string,
  path: string,
): string[] => {
  let places = alternatives(vocab, path)
  if (!places.length) return []
  let ast = parse(line)
  return places.flatMap((place) => {
    let changed = false
    let fix = (c: Clause): Clause => {
      if (c.kind == 'and' || c.kind == 'or') {
        return { ...c, clauses: c.clauses.map(fix) }
      }
      if (
        c.kind != 'pred' || c.where || c.not || c.op == '?' ||
        c.path.join('.') != path
      ) return c
      let next = place.length == 1
        ? beside(vocab, c, place[0])
        : { ...c, path: place }
      changed ||= next !== c
      return next
    }
    let next = fix(ast)
    return changed ? [stringify(next)] : []
  })
}

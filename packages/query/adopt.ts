// The write interpretation of the query AST. Boards take what a query pins
// down; an explicit write refuses everything that cannot describe one patch.
import type { Vocab } from '@yaks/vocab'
import type { Clause } from './ast.ts'

export type Patch = Record<string, Record<string, unknown> | null>

/** Turn scalar equalities (and forward reference walks) into a patch.
 * Types come from the vocabulary, never from a value's spelling. `null`
 * clears a property; `!component` removes it; `.component` ensures it.
 * By default filters that pin down no single value are ignored (board drops).
 * Strict writes reject them instead of silently performing a partial write.
 */
export function adopt(
  clause: Clause,
  vocab: Pick<Vocab, 'comp' | 'prop'>,
  { strict = false }: { strict?: boolean } = {},
): Patch {
  let out: Patch = {}
  let fail = (message: string) => {
    if (strict) throw new TypeError(message)
  }
  let component = (name: string): boolean => {
    if (name == 'entity' || vocab.comp(name)) return true
    fail(`unknown component: ${name}`)
    return false
  }
  let set = (comp: string, prop: string, raw: string) => {
    if (!component(comp)) return
    let field = vocab.prop(comp, prop)
    if (!field && !(comp == 'entity' && prop == 'eid')) {
      fail(`unknown property: ${comp}.${prop}`)
      return
    }
    if (strict && (field?.computed || field?.stamped)) {
      throw new TypeError(`read-only property: ${comp}.${prop}`)
    }
    let value: unknown = raw
    if (raw == 'null') value = null
    else if (field?.scalar == 'number' || field?.scalar == 'priority') {
      value = Number(raw)
      if (
        !raw.trim() || !Number.isFinite(value)
      ) {
        fail(`${comp}.${prop} needs a ${field.scalar}: ${raw}`)
        return
      }
    } else if (field?.scalar == 'bool') {
      if (raw != 'true' && raw != 'false') {
        fail(`${comp}.${prop} needs true or false: ${raw}`)
        return
      }
      value = raw == 'true'
    } else if (['jsonb', 'binary'].includes(field?.scalar ?? '')) {
      fail(`${comp}.${prop} needs structured JSON; use bundles`)
      return
    }
    if (strict && out[comp] === null) {
      throw new TypeError(`cannot remove and patch ${comp}`)
    }
    let values = out[comp] ??= {}
    if (strict && Object.hasOwn(values, prop)) {
      throw new TypeError(`repeated property: ${comp}.${prop}`)
    }
    values[prop] = value
  }
  let visit = (c: Clause) => {
    if (c.kind == 'and') {
      c.clauses.forEach(visit)
      return
    }
    if (c.kind == 'walk' && c.dir == '->' && c.path.length == 2) {
      set(c.path[0], c.path[1], c.target)
      return
    }
    if (c.kind != 'pred' || c.not || c.where) {
      fail(`not a writable clause: ${c.kind}`)
      return
    }
    if (
      c.path.length == 1 && (c.op == '!' && !c.value ||
        c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '')
    ) {
      let name = c.path[0]
      if (!component(name)) return
      if (strict && Object.hasOwn(out, name)) {
        throw new TypeError(`repeated component: ${name}`)
      }
      out[name] = c.op == '=' ? null : {}
      return
    }
    if (
      c.path.length == 2 && c.op == '=' &&
      (c.value?.kind == 'scalar' || c.value?.kind == 'time')
    ) {
      set(c.path[0], c.path[1], c.value.raw)
      return
    }
    fail(`not a scalar equality: ${c.path.join('.')}`)
  }
  visit(clause)
  return out
}

/** Experimental, pure bounded joins over host-supplied transaction views. */
import { type JoinRule, parseJoinRule } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'

export type JoinLimits = { candidates?: number; steps?: number }
export type JoinedRule = {
  ast: JoinRule
  /** Components read, including absence tests; not a subscription plan. */
  dependencies: readonly string[]
  /** One candidate set per pattern. Supply merged transaction views, not patches.
   * The caller owns indexed candidate discovery and transaction integration. */
  run: (candidates: readonly (readonly Bundle[])[]) => Bundle[]
}

/** Compile a rule without installing an executor or reading the graph.
 * Conflicting derivations refuse the entire evaluation; identical ones coalesce. */
export const joinRule = (
  source: string,
  vocab: Vocab,
  limits: JoinLimits = {},
): JoinedRule => {
  const ast = parseJoinRule(source)
  const maxCandidates = limits.candidates ?? 1024
  const maxSteps = limits.steps ?? 10000
  for (const limit of [maxCandidates, maxSteps]) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Invalid join limit')
    }
  }
  const bound = new Set<string>()
  const types = new Map<string, string>()
  const dependencies = new Set<string>()
  const typed = (variable: string, type: string) => {
    const was = types.get(variable)
    if (was && was != type) {
      throw new Error(`Incompatible types for $${variable}: ${was}, ${type}`)
    }
    types.set(variable, type)
  }
  for (const pattern of ast.patterns) {
    if (pattern.variable) {
      bound.add(pattern.variable)
      typed(pattern.variable, 'string')
    }
    for (const part of [...pattern.match, ...pattern.gates]) {
      if (!vocab.comps.includes(part.component)) {
        throw new Error(`Unknown component ${part.component}`)
      }
      dependencies.add(part.component)
      for (const binding of part.bindings) {
        const column = vocab.column(part.component, binding.property)
        if (!column) {
          throw new Error(
            `Unknown property ${part.component}.${binding.property}`,
          )
        }
        const type = column.scalar == 'bool'
          ? 'boolean'
          : column.scalar == 'number' || column.scalar == 'priority'
          ? 'number'
          : 'string'
        typed(binding.variable, type)
      }
    }
    for (const part of pattern.match) {
      for (const binding of part.bindings) bound.add(binding.variable)
    }
  }
  for (const pattern of ast.patterns) {
    for (const gate of pattern.gates) {
      for (const binding of gate.bindings) {
        if (!bound.has(binding.variable)) {
          throw new Error(`Unbound action variable $${binding.variable}`)
        }
      }
    }
  }
  const run: JoinedRule['run'] = (sets) => {
    if (sets.length != ast.patterns.length) {
      throw new Error('One candidate set is required per entity pattern')
    }
    if (sets.reduce((n, set) => n + set.length, 0) > maxCandidates) {
      throw new Error('Join candidate limit exceeded')
    }
    const views = new Map<string, Bundle>()
    const candidates = sets.map((set) => {
      const unique = new Map<string, Bundle>()
      for (const row of set) {
        const id = row.entity.eid
        const previous = views.get(id)
        if (previous && JSON.stringify(previous) != JSON.stringify(row)) {
          throw new Error(`Conflicting candidate views for ${id}`)
        }
        views.set(id, row)
        unique.set(id, row)
      }
      return [...unique.values()]
    })
    let steps = 0
    const produced = new Map<string, Bundle>()
    const walk = (index: number, env: Map<string, unknown>, rows: Bundle[]) => {
      if (index == ast.patterns.length) {
        for (let i = 0; i < rows.length; i++) {
          const id = rows[i].entity.eid
          for (const gate of ast.patterns[i].gates) {
            const values = Object.fromEntries(
              gate.bindings.map((b) => [b.property, env.get(b.variable)]),
            )
            let output = produced.get(id)
            if (!output) produced.set(id, output = { entity: { eid: id } })
            const previous = output[gate.component] as Comp | undefined
            if (previous) {
              for (const [key, value] of Object.entries(values)) {
                if (key in previous && !Object.is(previous[key], value)) {
                  throw new Error(
                    `Ambiguous join writes ${id}.${gate.component}.${key}`,
                  )
                }
              }
            }
            output[gate.component] = { ...previous, ...values }
          }
        }
        return
      }
      const pattern = ast.patterns[index]
      for (const row of candidates[index]) {
        if (++steps > maxSteps) throw new Error('Join step limit exceeded')
        const next = new Map(env)
        const bind = (variable: string, value: unknown) => {
          if (value == null || typeof value != types.get(variable)) return false
          if (next.has(variable)) return Object.is(next.get(variable), value)
          next.set(variable, value)
          return true
        }
        if (pattern.variable && !bind(pattern.variable, row.entity.eid)) {
          continue
        }
        if (pattern.gates.some((p) => row[p.component] != null)) continue
        const matches = pattern.match.every((p) => {
          const value = row[p.component]
          return value != null && typeof value == 'object' &&
            p.bindings.every((b) =>
              bind(b.variable, (value as Comp)[b.property])
            )
        })
        if (matches) walk(index + 1, next, [...rows, row])
      }
    }
    walk(0, new Map(), [])
    return [...produced.values()]
  }
  return { ast, dependencies: [...dependencies], run }
}

/** Experimental multi-entity rule syntax. Separate from ordinary query parsing. */
export type PropertyBinding = { property: string; variable: string }
export type ComponentPattern = {
  component: string
  bindings: PropertyBinding[]
}
export type EntityPattern = {
  variable?: string
  match: ComponentPattern[]
  /** Absent-component gates, added to this matched entity after a join. */
  gates: ComponentPattern[]
}
export type JoinRule = { kind: 'join-rule'; patterns: EntityPattern[] }

/** Parse component-presence patterns, variable bindings and absent/add gates.
 * No literals, positional arguments, query directives or arbitrary expressions. */
export const parseJoinRule = (source: string): JoinRule => {
  let at = 0
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at offset ${at}`)
  }
  const space = () => {
    while (/\s/.test(source[at] ?? '') && at < source.length) at++
  }
  const name = (): string => {
    const found = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(at))
    if (!found) return fail('Expected name')
    at += found[0].length
    return found[0]
  }
  const variable = (): string => {
    if (source[at++] != '$') return fail('Expected variable')
    return name()
  }
  const patterns: EntityPattern[] = []
  space()
  while (at < source.length) {
    const pattern: EntityPattern = { match: [], gates: [] }
    if (source[at] == '$') pattern.variable = variable()
    space()
    while (at < source.length && source[at] != ';') {
      const gate = source.startsWith('+!', at)
      if (gate) at += 2
      else if (source[at] == '.') at++
      else fail('Expected .component or +!component')
      const component = name()
      const bindings: PropertyBinding[] = []
      space()
      if (source[at] == '{') {
        at++
        space()
        while (source[at] != '}') {
          let property: string, v: string
          if (source[at] == '$') property = v = variable()
          else {
            property = name()
            space()
            if (source[at++] != ':') fail('Expected colon')
            space()
            v = variable()
          }
          if (bindings.some((b) => b.property == property)) {
            fail(`Duplicate property ${property}`)
          }
          bindings.push({ property, variable: v })
          space()
          if (source[at] == '}') break
          if (source[at++] != ',') fail('Expected comma or closing brace')
          space()
        }
        at++
      }
      ;(gate ? pattern.gates : pattern.match).push({ component, bindings })
      space()
    }
    if (!pattern.match.length) {
      fail('Each entity needs a positive component pattern')
    }
    patterns.push(pattern)
    if (source[at] == ';') {
      at++
      space()
      if (at == source.length) fail('Expected entity pattern after semicolon')
    }
  }
  if (!patterns.length) fail('Expected entity pattern')
  return { kind: 'join-rule', patterns }
}

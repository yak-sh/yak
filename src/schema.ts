// The vocabulary, read back out: one derivation over types.ts that the
// Schema view (browser) and the boot-regenerated Vocabulary doc (server)
// both render. Nothing here is authored — every row comes from comps,
// stamped, edges, and statuses, so this file can describe the schema but
// never contradict it. Effects are the one part types.ts can't see (the
// registry fills at server boot), so renderers take them as an argument.
import {
  comps,
  type Death,
  edges,
  type PropType,
  stamped,
  statuses,
} from './types.ts'

// One column, flattened for rendering: what it's called, what it IS
// (typeWord), whether the server owns it, and — for references — the
// death word and the target's component ('' = any entity).
export type Col = {
  col: string
  type: string
  stamped: boolean
  target?: string
  death?: Death
}

// A PropType said in one word or phrase — the same spelling everywhere
// the schema is shown (view, doc, and whatever asks next).
export let typeWord = (t: PropType): string =>
  typeof t == 'string'
    ? t
    : 'enum' in t
    ? t.enum.join(' | ')
    : 'eid' in t
    ? `→ ${t.eid || 'any'}`
    : `text (${t.text})`

// Every component with every column — wire-writable first, then the
// server-stamped union, in declaration order. `entity` (the spine) rides
// only in stamped, so it leads the list there and lands first here.
export let schema = (): { comp: string; cols: Col[] }[] => {
  let names = [...new Set([...Object.keys(stamped), ...Object.keys(comps)])]
  return names.map((comp) => ({
    comp,
    cols: [
      ...Object.entries(comps[comp] ?? {}).map(([col, t]) =>
        flat(col, t, false)
      ),
      ...Object.entries(stamped[comp] ?? {}).map(([col, t]) =>
        flat(col, t, true)
      ),
    ],
  }))
}

let flat = (col: string, t: PropType, isStamped: boolean): Col => ({
  col,
  type: typeWord(t),
  stamped: isStamped,
  ...(typeof t == 'object' && 'eid' in t
    ? { target: t.eid, death: t.death }
    : {}),
})

// The edge vocabulary as sentences — parent first, the way db.ts and the
// UI both read them.
export let edgeLines = edges.map((e) => `parent ${e} child`)

// What one effect registration looks like once effects.ts docs() has
// read the registry back.
export type EffectDoc = {
  comp: string
  hooks: string[]
  sweep?: string
  doc?: string
}

// The whole vocabulary as one markdown document — the body of the
// boot-regenerated `vocabulary` doc entity. Regenerated every boot from
// the live structures, so it can go stale by at most one restart and
// can never disagree with the code that shipped it.
export let vocabularyMd = (effects: EffectDoc[]): string => {
  let lines = [
    '# Vocabulary',
    '',
    'What the graph is made of — generated at boot from the running',
    "code (types.ts, the effects registry), so it can't drift from it.",
    'An entity is a uuid + a number; its components make it what it is.',
    '',
    '## Components',
    '',
    'Columns marked ⚙ are server-stamped — never wire-writable. A `→`',
    'column is a reference; its death word says what happens when the',
    'target dies: **cascade** (the row’s entity dies too), **detach**',
    '(the column nulls), **release** (the row dies, its entity lives),',
    '**keep** (the reference stands as history).',
    '',
  ]
  for (let { comp, cols } of schema()) {
    lines.push(`### ${comp}`, '')
    for (let c of cols) {
      lines.push(
        `- \`${c.col}\` ${c.type}` +
          (c.death ? ` (${c.death})` : '') +
          (c.stamped ? ' ⚙' : ''),
      )
    }
    if (!cols.length) lines.push('- (a tag — the row is the statement)')
    lines.push('')
  }
  lines.push(
    '## Edges',
    '',
    ...edgeLines.map((s) => `- ${s}`),
    '',
    '## Task statuses',
    '',
    `- ${statuses.join(' → ')}`,
    '',
    '## Effects',
    '',
    'Post-commit levers the server pulls when the graph changes',
    '(registered in server.ts; this list IS the registry).',
    '',
  )
  for (let e of effects) {
    lines.push(
      `- **${e.comp}** ${e.hooks.join(', ')}${
        e.sweep ? ` · swept at boot while \`${e.sweep}\`` : ''
      }${e.doc ? ` — ${e.doc}` : ''}`,
    )
  }
  return lines.join('\n')
}

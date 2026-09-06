// What every agent reads at the start of every conversation: the person's own
// sentences, newest first, under one heading per space.
//
// BOUNDED, because it is paid for on every connection — {@link LAST} of them
// and {@link BYTES} bytes, whichever runs out first, and then a line saying how
// many are not shown and which tool answers with the rest. A person who has
// said forty things is not owed forty of them at the top of every context; they
// are owed the last few and a door to the others.
//
// Each entry is the SENTENCE, whole and in quotes, with its context indented
// under it. Whole, because half of what somebody said is worse than none of it
// — a snippet is for finding a thing, and this is the thing.

import type { Memory } from './recall.ts'

/** The most memories a passage shows. */
export let LAST = 8

/** The most bytes it spends on them. */
export let BYTES = 2048

let bytes = (s: string) => new TextEncoder().encode(s).length

// One memory: what was said, then what is needed to read it. A byline only
// where somebody other than the person the heading names said it — in a space
// of one, which is most of them, it would be the same name every time.
let entry = (m: Memory, name: string): string => {
  let said = `"${m.said.trim()}"` +
    (m.by && m.by != name ? ` — ${m.by}` : '')
  let under = [
    ...(m.about ? [`about the ${m.about} app`] : []),
    ...(m.context ? m.context.split('\n') : []),
  ]
  return [said, ...under.map((l) => `  ${l}`)].join('\n')
}

// What is not shown, said once. Never a number: the passage reads what it can
// afford and nothing counts the rest, which would be a second query on every
// connection to say something the tool already answers.
let MORE = 'There are more — memory_recall finds any of them by what they ' +
  'are about.'

/**
 * One space's memories as the passage says them, or '' where it has none.
 * `name` is the person the heading is about — whoever said most of them.
 *
 * ```ts
 * // ## What Jeff has said
 * // In ada, his own words, newest first…
 * //
 * // "use grams, never cups"
 * //   about the recipes app
 * ```
 */
export let passage = (
  where: { name: string; space: string },
  held: Memory[],
): string => {
  if (!held.length) return ''
  let name = where.name || 'the person'
  let head = `## What ${name} has said\n` +
    `In ${where.space}, their own words about how they want things done ` +
    'here, newest first. When they say how something should be built or ' +
    'handled, keep their exact words with memory_save.'
  let out: string[] = []
  let spent = 0
  for (let m of held.slice(0, LAST)) {
    let said = entry(m, name)
    spent += bytes(said)
    if (spent > BYTES && out.length) break
    out.push(said)
  }
  return [head, ...out, ...(held.length > out.length ? [MORE] : [])]
    .join('\n\n')
}

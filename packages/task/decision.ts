/** Questions and answers: pure values, checked at the graph's write boundary. */
import { after } from '@yaks/fp'
import type { Bundle, Comp, Hook } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Built, line } from '@yaks/query'

/** A label and a line saying what choosing it means. */
export type Choice = { label: string; description: string }
/** The ask, read whole by every door. */
export type Decision = {
  question: string
  choices: Choice[]
  recommended: string
}

/** What each choice presents, by label, in the order the decision shows them:
 * read from its `shows` edges (`edge{from, to, ord}` + `shows{choice}`). */
export type Shown = Map<string, string[]>

/** The query for a decision's `shows` edges. */
export let showing = (eid: string): Built => line`.edge.from=${eid}&.shows`

/** Each choice's shown entities, from the decision's `shows` edges. */
export let shown = (edges: Bundle[]): Shown => {
  let out: Shown = new Map()
  let sorted = [...edges].sort((a, b) =>
    Number((a.edge as Comp)?.ord ?? 0) - Number((b.edge as Comp)?.ord ?? 0)
  )
  for (let b of sorted) {
    let choice = (b.shows as Comp | undefined)?.choice
    let to = (b.edge as Comp | undefined)?.to
    if (choice == null || to == null) continue
    out.set(String(choice), [...out.get(String(choice)) ?? [], String(to)])
  }
  return out
}

/** The `shows` edges a new decision writes, one for each choice that shows
 * an entity, ordered as the choices are. */
export let shows = (
  from: string,
  choices: (Choice & { shows?: string })[],
): Bundle[] =>
  choices.flatMap((c, i) =>
    c.shows
      ? [{
        entity: { eid: `$shows-${i}` },
        edge: { from, to: c.shows, ord: i },
        shows: { choice: c.label },
      }]
      : []
  )

/** The query for the decisions waiting on `person`: assigned to them, and
 * neither answered nor cancelled. */
export let waiting = (person: string): Built =>
  line`.decision .filed.assignee=${person} !decided !cancelled`

/**
 * The decisions in `rows` as one line each: its id (`id`, the eid where it
 * gives none), its question and its choices' labels, the recommended one
 * marked.
 *
 * ```ts
 * import { asked } from '@yaks/task'
 * import { equal } from '@yaks/testing'
 *
 * let row = {
 *   entity: { eid: 'e1' },
 *   decision: {
 *     question: 'Which cover?',
 *     choices: [{ label: 'Gothic' }, { label: 'Plain' }],
 *     recommended: 'Plain',
 *   },
 * }
 * equal(asked([row], () => 'T-4'), '- T-4: Which cover? "Gothic", "Plain" (recommended)')
 * equal(asked([]), '')
 * ```
 */
export let asked = (
  rows: Bundle[],
  id: (eid: string) => string | undefined = () => undefined,
): string =>
  rows.map((b) => {
    let d = b.decision as Decision
    let labels = d.choices.map((c) =>
      JSON.stringify(c.label) +
      (c.label == d.recommended ? ' (recommended)' : '')
    )
    return `- ${id(b.entity.eid) ?? b.entity.eid}: ${d.question} ${
      labels.join(', ')
    }`
  }).join('\n')

/** The answer a door writes, optionally recording another person's words. */
export let answer = (eid: string, choice: string, by?: string): Bundle[] => [{
  entity: { eid },
  decided: { choice: choice.trim() },
  ...(by ? { $decider: by } : {}),
}]

/** Refuses a decision that is not whole: a store composing only this
 * package's vocabulary runs no {@link deciding}, so decision_new checks the
 * ask it builds too. */
export let check = (b: Bundle): void => {
  let d = b.decision as Decision
  if (b.task == null) throw new Refused('A decision must be a task')
  if (!d.question?.trim()) throw new Refused('A decision needs a question')
  if (
    !Array.isArray(d.choices) || d.choices.length < 2 || d.choices.length > 4
  ) {
    throw new Refused('Offer two to four choices')
  }
  let labels = d.choices.map((c) => c.label?.trim())
  if (labels.some((l) => !l) || new Set(labels).size != labels.length) {
    throw new Refused('Choice labels must be nonempty and distinct')
  }
  if (d.choices.some((c) => !c.description?.trim())) {
    throw new Refused('Each choice needs a description')
  }
  if (!d.choices.some((c) => c.label == d.recommended)) {
    let labels = d.choices.map((c) => JSON.stringify(c.label)).join(', ')
    throw new Refused(`Recommend one of the choices by its label: ${labels}`, {
      comp: 'decision',
      prop: 'recommended',
    })
  }
  if (b.decided && !(b.decided as Comp).choice?.toString().trim()) {
    throw new Refused('Answer a decision with a choice')
  }
}

/** Validate the merged decision, including partial edits and direct graph writes. */
export let deciding: Hook = (bundles, tx) => {
  let touched = bundles.filter((b) =>
    'decision' in b || 'decided' in b || 'task' in b
  )
  if (!touched.length) return bundles
  return after(tx.get(touched.map((b) => b.entity.eid)), (rows) => {
    let held = new Map(rows.map((b) => [b.entity.eid, b]))
    for (let b of touched) {
      let old = held.get(b.entity.eid)
      let next = { ...old, ...b }
      if (b.decision && old?.decision) {
        next.decision = { ...old.decision as Comp, ...b.decision as Comp }
      }
      if (!next.decision) {
        if ((b.decided as Comp)?.choice != null) {
          throw new Refused('Only a decision can be answered with a choice')
        }
        continue
      }
      if (b.decided != null && (old?.decided || next.cancelled)) {
        throw new Refused('This decision is already answered or cancelled')
      }
      check(next)
      held.set(b.entity.eid, next)
    }
    return bundles
  })
}

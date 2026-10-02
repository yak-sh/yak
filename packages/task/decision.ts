/** Questions and answers: pure values, checked at the graph's write boundary. */
import { after } from '@yaks/fp'
import { type Bundle, type Comp, type Hook, Refused } from '@yaks/graph'

/** A label and a line saying what choosing it means. */
export type Choice = { label: string; description: string }
/** The ask, read whole by every door. */
export type Decision = {
  question: string
  choices: Choice[]
  recommended: string
}

/** The answer a door writes. Attribution is filled by the server, never here. */
export let answer = (eid: string, choice: string): Bundle[] => [{
  entity: { eid },
  decided: { choice: choice.trim() },
}]

let check = (b: Bundle): void => {
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
    throw new Refused('Recommend a listed choice by label')
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

// An ability's effects are plain data shared by combat, descriptions and
// skill forms. The Store keeps their allowed shapes in the app vocabulary.

export type Effect =
  | { kind: 'damage'; scale: number; hits?: number; sure?: boolean }
  | { kind: 'bleed'; scale: number }
  | { kind: 'stun'; ms: number }
  | { kind: 'dash'; metres: number; behind?: boolean }
  | { kind: 'guard'; ms: number }
  | { kind: 'ward'; share: number }
  | { kind: 'heal'; share: number }
  | { kind: 'renew' }
  | { kind: 'refund' }

export type Kind = Effect['kind']

/** At most one effect of each kind; a skill replaces that kind's whole value. */
export let changed = (effects: Effect[], edits: Effect[]): Effect[] => {
  let next = [...effects]
  for (let edit of edits) {
    let at = next.findIndex((e) => e.kind == edit.kind)
    if (at < 0) next.push(edit)
    else next[at] = edit
  }
  return next
}

export let effect = <K extends Kind>(
  effects: Effect[],
  kind: K,
): Extract<Effect, { kind: K }> | undefined =>
  effects.find((e): e is Extract<Effect, { kind: K }> => e.kind == kind)

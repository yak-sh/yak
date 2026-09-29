// A wizard's proposed ability is checked and priced from the same vocabulary
// that admits it to the Store. Combat need only import ability-effects.ts.
import { numberOf } from '@yaks/vocab/constraints'
import { toolCheck } from '@yaks/vocab/tools'
import type { Ability } from './abilities.ts'
import words from './vocab.json' with { type: 'json' }

let COST = words.$defs.ability_design.constraints[0]
let check = toolCheck(words.$defs.ability_design)

export let DESIGN_BUDGET = COST.maximum
export let price = (a: Ability): number => numberOf(COST.value, a)

/** A proposal fits only when its effects and target can be priced exactly. */
export let fits = (a: Ability, budget = DESIGN_BUDGET): boolean =>
  Number.isFinite(budget) && budget >= 0 &&
  !check({ kind: 'candidate', ...a }).length &&
  price(a) <= Math.min(budget, DESIGN_BUDGET)

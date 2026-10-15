// Pure live-cooking model. Recipe inputs are already-decoded local objects.
// These rows are frozen session history, never a recipe-authoring model.

/** Interleave lists without losing the order within any list. */
export function roundRobin(lists) {
  const result = []
  const length = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < length; index++) {
    for (const list of lists) {
      if (index < list.length) result.push(list[index])
    }
  }
  return result
}

// A range uses its upper bound, so a timer does not expire before the stated
// cooking window. Adjacent units form one duration; separate phases do not:
// "cook 10 min, rest 5 min" offers 10 min, with an explicit manual override.
/** Parse the first explicit duration in seconds; null means set it manually. */
export function parseDuration(text) {
  const normalized = String(text).toLowerCase()
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4')
    .replace(/\bhalf\s+(?:an?\s+)?/g, '0.5 ')
    .replace(/\ban?\s+(?=(?:hour|minute|second)\b)/g, '1 ')
  const number = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)'
  const unit = '(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)'
  const pattern = new RegExp(
    `(${number})(?:\\s*(?:-|–|—|to)\\s*(${number}))?\\s*(${unit})\\b`,
    'g',
  )
  const value = (word) => {
    const parts = word.trim().split(/\s+/)
    return parts.reduce((sum, part) => {
      const [top, bottom] = part.split('/').map(Number)
      return sum + (bottom === undefined ? top : top / bottom)
    }, 0)
  }
  let total = 0
  let end = -1
  for (const match of normalized.matchAll(pattern)) {
    if (
      end >= 0 && !/^\s*(?:and\s*)?$/.test(normalized.slice(end, match.index))
    ) break
    // Do not parse the tail of a word, malformed fraction or negative value.
    const before = normalized.slice(0, match.index)
    if (/[\w./]$/.test(before) || /-\s*$/.test(before)) continue
    const count = value(match[2] ?? match[1])
    const scale = match[3].startsWith('h')
      ? 3600
      : match[3].startsWith('m')
      ? 60
      : 1
    if (!Number.isFinite(count) || count <= 0) return null
    total += count * scale
    end = match.index + match[0].length
  }
  return end < 0 || !Number.isSafeInteger(Math.ceil(total))
    ? null
    : Math.ceil(total)
}

export function validSeconds(value) {
  const seconds = typeof value === 'string' && !value.trim()
    ? NaN
    : Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error('Enter a positive whole number of seconds.')
  }
  return seconds
}

/**
 * Build one atomic creation batch. UUIDs are minted once, never in render.
 * @param {{eid: string, title: string, ingredients: string[], steps: string[]}[]} recipes
 * @param {() => string} uuid
 */
export function snapshotSession(recipes, uuid = () => crypto.randomUUID()) {
  if (!Array.isArray(recipes) || recipes.length === 0) {
    throw new Error('Select at least one recipe.')
  }
  const seen = new Set()
  for (const recipe of recipes) {
    if (
      !recipe.eid || seen.has(recipe.eid) || typeof recipe.title !== 'string' ||
      !Array.isArray(recipe.ingredients) || !recipe.ingredients.every((v) =>
        typeof v === 'string'
      ) ||
      !Array.isArray(recipe.steps) ||
      !recipe.steps.every((v) => typeof v === 'string')
    ) {
      throw new Error(
        'Cooking needs distinct recipes with a title, ingredients and steps.',
      )
    }
    seen.add(recipe.eid)
  }
  const eid = uuid()
  /** @type {Array<{entity: {eid: string}, cooking?: object, doc?: {title: string}, cook_recipe?: {session: string, recipe: string, ord: number, title: string, ingredients: string[]}, cook_step?: {session: string, recipe: string, ord: number, text: string, seconds?: number}}>} */
  const bundles = [{
    entity: { eid },
    cooking: {},
    doc: { title: recipes.map((r) => r.title).join(' + ') },
  }]
  const steps = recipes.map((recipe, ord) => {
    const recipeId = uuid()
    bundles.push({
      entity: { eid: recipeId },
      cook_recipe: {
        session: eid,
        recipe: recipe.eid,
        ord,
        title: recipe.title,
        ingredients: [...recipe.ingredients],
      },
    })
    return recipe.steps.map((text, index) => {
      const seconds = parseDuration(text)
      return {
        entity: { eid: uuid() },
        cook_step: {
          session: eid,
          recipe: recipeId,
          ord: 0,
          text,
          ...(seconds === null ? {} : { seconds }),
        },
        doc: { title: `${recipe.title} · Step ${index + 1}: ${text}` },
      }
    })
  })
  roundRobin(steps).forEach((step, ord) => {
    step.cook_step.ord = ord
    bundles.push(step)
  })
  return { eid, bundles }
}

/** Ordered ingredient snapshots, independently round-robin from the steps. */
export function cookingIngredients(recipeRows) {
  const ordered = [...recipeRows].sort((a, b) =>
    a.cook_recipe.ord - b.cook_recipe.ord
  )
  return roundRobin(ordered.map((row) => {
    const ingredients = row.cook_recipe.ingredients
    if (
      !Array.isArray(ingredients) ||
      !ingredients.every((v) => typeof v === 'string')
    ) {
      throw new Error('Invalid cooking ingredient snapshot.')
    }
    return ingredients.map((text) => ({
      recipe: row.entity.eid,
      title: row.cook_recipe.title,
      text,
    }))
  }))
}

/** A timer's expiry is computed from its deadline even after closing the page. */
export function timerRemaining(timer, now = Date.now()) {
  if (!timer) return null
  if (timer.due != null) {
    const due = Date.parse(timer.due)
    if (!Number.isFinite(due)) throw new Error('Invalid timer deadline.')
    return Math.max(0, Math.ceil((due - now) / 1000))
  }
  if (
    timer.remaining != null && Number.isFinite(timer.remaining) &&
    timer.remaining >= 0
  ) {
    return Math.ceil(timer.remaining)
  }
  throw new Error('A timer needs a deadline or paused seconds.')
}

/** Replacement property patches explicitly clear the opposite timer mode. */
export function timerChange(
  step,
  action,
  now = Date.now(),
  seconds = step.cook_step.seconds,
) {
  if (step.completed) {
    throw new Error('Reopen this step before changing its timer.')
  }
  if (action === 'reset') return { due: null, remaining: validSeconds(seconds) }
  if (action === 'pause') {
    if (step.timer?.due == null) throw new Error('This timer is not running.')
    return { due: null, remaining: timerRemaining(step.timer, now) }
  }
  if (action === 'start') {
    if (step.timer?.due != null) {
      throw new Error('This timer is already running.')
    }
    const duration = step.timer?.remaining ?? validSeconds(seconds)
    if (duration <= 0) {
      throw new Error('Reset the expired timer before starting it.')
    }
    return {
      due: new Date(now + duration * 1000).toISOString(),
      remaining: null,
    }
  }
  throw new Error('Unknown timer action.')
}

export function formatSeconds(seconds) {
  const value = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(value / 3600)
  const m = Math.floor(value % 3600 / 60)
  const s = String(value % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

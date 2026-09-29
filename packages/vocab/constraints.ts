// A finite weighted sum, kept as data so a page and the graph admitting its
// writes use the same numbers. Terms can sum bounded array members, select
// exact variants, and multiply constants by fields or their reciprocals.

export type Factor = number | {
  field: string
  default?: number
  inverse?: boolean
}

export type Term = {
  each?: string
  where?: Record<string, string | number | boolean | null>
  product: Factor[]
}

export type Score = { sum: Term[] }

export type NumericConstraint = {
  name: string
  value: Score
  maximum: number
  message: string
}

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let only = (row: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(row).every((key) => keys.includes(key))

let number = (value: unknown): value is number =>
  typeof value == 'number' && Number.isFinite(value)

let scalar = (value: unknown): boolean =>
  value === null || typeof value == 'string' ||
  typeof value == 'boolean' || number(value)

let shapedFactor = (value: unknown): boolean =>
  number(value) ||
  (object(value) && only(value, ['field', 'default', 'inverse']) &&
    typeof value.field == 'string' && !!value.field &&
    (value.default === undefined || number(value.default)) &&
    (value.inverse === undefined || typeof value.inverse == 'boolean'))

let shapedTerm = (value: unknown): boolean =>
  object(value) && only(value, ['each', 'where', 'product']) &&
  (value.each === undefined ||
    (typeof value.each == 'string' && !!value.each)) &&
  (value.where === undefined ||
    (object(value.where) && Object.values(value.where).every(scalar))) &&
  Array.isArray(value.product) && value.product.length <= 16 &&
  value.product.every(shapedFactor)

let shapedScore = (value: unknown): boolean =>
  object(value) && only(value, ['sum']) && Array.isArray(value.sum) &&
  value.sum.length <= 100 && value.sum.every(shapedTerm)

let shapedConstraint = (value: unknown): boolean =>
  object(value) && only(value, ['name', 'value', 'maximum', 'message']) &&
  typeof value.name == 'string' && !!value.name &&
  shapedScore(value.value) && number(value.maximum) &&
  typeof value.message == 'string' && !!value.message

/** Errors in a component's numeric declarations, before a store accepts it. */
export let constraintErrors = (value: unknown): string[] =>
  !Array.isArray(value)
    ? ['constraints must be an array']
    : value.flatMap((item, i) =>
      shapedConstraint(item) ? [] : [`constraint ${i} has an invalid score`]
    )

let finite = (value: unknown): number => {
  if (!number(value)) {
    throw new Error('score factors must be finite numbers')
  }
  return value
}

let factor = (part: Factor, row: Record<string, unknown>): number => {
  if (typeof part == 'number') return finite(part)
  if (!object(part) || typeof part.field != 'string' || !part.field) {
    throw new Error('score factor must name a field')
  }
  let held = Object.hasOwn(row, part.field) ? row[part.field] : undefined
  let value = finite(held == null ? part.default : held)
  if (part.inverse !== true) return value
  if (value <= 0) throw new Error(`${part.field} must be positive`)
  return 1 / value
}

let matches = (term: Term, row: Record<string, unknown>): boolean =>
  Object.entries(term.where ?? {}).every(([field, value]) =>
    Object.hasOwn(row, field) && row[field] === value
  )

let items = (term: Term, row: Record<string, unknown>) => {
  if (!term.each) return [row]
  let array = row[term.each]
  if (
    !Array.isArray(array) || array.length > 100 ||
    !array.every(object)
  ) {
    throw new Error(`${term.each} must be an array of at most 100 objects`)
  }
  return array
}

/** Evaluate a bounded score over one complete component. */
export let numberOf = (score: Score, row: object): number => {
  if (!score || !Array.isArray(score.sum) || score.sum.length > 100) {
    throw new Error('score has at most 100 terms')
  }
  let fields = Object.fromEntries(Object.entries(row))
  let sum = 0
  for (let term of score.sum) {
    if (
      !object(term) || !Array.isArray(term.product) ||
      term.product.length > 16
    ) {
      throw new Error('a score term has at most 16 factors')
    }
    if (term.where !== undefined && !object(term.where)) {
      throw new Error('score where must be an object')
    }
    for (let item of items(term, fields)) {
      if (!matches(term, item)) continue
      let value = term.product.reduce<number>(
        (n, part) => n * factor(part, item),
        1,
      )
      sum = finite(sum + finite(value))
    }
  }
  if (sum < 0) throw new Error('score cannot be negative')
  return sum
}

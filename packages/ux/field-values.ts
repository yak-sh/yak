/** Paths and immutable values shared by controlled fields and submissions. @module */
export type Values = Readonly<Record<string, unknown>>
export type Path = (string | number)[]
export let named = (path: readonly (string | number)[]): string =>
  path.join('.')
/** The value at `path`, set to `value`; undefined removes it. */
export let put = (
  values: Values,
  [key, ...rest]: readonly (string | number)[],
  value: unknown,
): Values => {
  let next: Record<string, unknown> = { ...values }
  if (rest.length == 0) {
    if (value === undefined) delete next[key]
    else next[key] = value
    return next
  }
  let list = Array.isArray(values[key]) ? [...values[key] as Values[]] : []
  let [at, ...deeper] = rest as [number, ...(string | number)[]]
  list[at] = deeper.length
    ? put(list[at] ?? {}, deeper, value)
    : value as Values
  next[key] = list
  return next
}

/** The value at `path`. */
export let valueAt = (
  values: Values,
  path: readonly (string | number)[],
): unknown =>
  path.reduce<unknown>(
    (at, key) => (at as Record<string | number, unknown> | undefined)?.[key],
    values,
  )

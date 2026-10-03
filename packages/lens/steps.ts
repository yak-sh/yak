/** Rails-style UTC timestamps, written as YYYYMMDDHHMMSS. */
export let timestamp = (value: unknown): value is number => {
  if (typeof value != 'number' || !Number.isSafeInteger(value)) return false
  let text = String(value)
  if (!/^\d{14}$/.test(text)) return false
  let iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${
    text.slice(8, 10)
  }:${text.slice(10, 12)}:${text.slice(12, 14)}.000Z`
  let date = new Date(iso)
  return !Number.isNaN(date.valueOf()) && date.toISOString() == iso
}

/** Validate and order a package's history, retaining the pilot's landed
 * zero-based steps and count versions. New histories use timestamps. */
export let history = <T extends { step: number }>(
  declarations: readonly T[],
  speaks?: number,
): { steps: T[]; version: number; remaining: T[] } => {
  let fail = (why: string): never => {
    throw new Error(`Lens: ${why}`)
  }
  let steps = declarations.toSorted((a, b) => a.step - b.step)
  let legacy = 0, previous = -1
  for (let { step } of steps) {
    if (step == previous) fail(`duplicate step ${step}`)
    if (!timestamp(step)) {
      if (step !== legacy || previous >= 10000000000000) {
        fail(`invalid step ${step}; expected YYYYMMDDHHMMSS`)
      }
      legacy++
    }
    previous = step
  }
  let version = previous >= 10000000000000 ? previous : legacy
  let start = speaks ?? version
  if (
    !Number.isSafeInteger(start) || start < 0 ||
    !(start <= legacy || timestamp(start) && start <= version)
  ) fail(`unknown version ${start}`)
  return {
    steps,
    version,
    remaining: steps.filter(({ step }) =>
      timestamp(start) ? step > start : timestamp(step) || step >= start
    ),
  }
}

// A fixed-rate simulation plan over elapsed milliseconds. The caller keeps the
// remainder, runs the returned number of steps, and draws with alpha between
// the previous and current simulation values. There is no clock or hidden state.
export type FixedStep = {
  steps: number
  /** Duration of each simulation step, in milliseconds. */
  dt: number
  remainder: number
  /** Fraction of the next step available for interpolation. */
  alpha: number
  /** Whole steps discarded when catching up would exceed maxSteps. */
  dropped: number
}

/** Plan a 20-Hz simulation by default. Pass the returned remainder to the
 * next call. At most maxSteps execute per frame; excess whole steps are
 * discarded, retaining only the fractional remainder after a long pause. */
export let fixedStep = (
  elapsed: number,
  remainder = 0,
  hz = 20,
  maxSteps = 5,
): FixedStep => {
  if (
    !Number.isFinite(elapsed) || elapsed < 0 ||
    !Number.isFinite(hz) || hz <= 0 ||
    !Number.isInteger(maxSteps) || maxSteps < 1
  ) {
    throw new RangeError(
      'elapsed must be nonnegative; hz and maxSteps must be positive',
    )
  }
  let dt = 1000 / hz
  if (!Number.isFinite(remainder) || remainder < 0 || remainder >= dt) {
    throw new RangeError('remainder must be within one step')
  }
  let total = elapsed + remainder
  let available = Math.floor(total / dt)
  let steps = Math.min(available, maxSteps)
  let rest = total - available * dt
  return {
    steps,
    dt,
    remainder: rest,
    alpha: rest / dt,
    dropped: available - steps,
  }
}

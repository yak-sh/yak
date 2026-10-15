import { equal, test, throws } from '@yaks/testing'
import { fixedStep } from './step.ts'

test('fixed step carries fractional time and gives interpolation at display rate', () => {
  let first = fixedStep(30)
  equal(first, { steps: 0, dt: 50, remainder: 30, alpha: 0.6, dropped: 0 })
  equal(fixedStep(45, first.remainder), {
    steps: 1,
    dt: 50,
    remainder: 25,
    alpha: 0.5,
    dropped: 0,
  })
  equal(fixedStep(25, 25), {
    steps: 1,
    dt: 50,
    remainder: 0,
    alpha: 0,
    dropped: 0,
  })
  equal(fixedStep(0).steps, 0)
  let remainder = 0, steps = 0
  for (let elapsed of [17, 16, 17, 10, 40, 30, 20, 50]) {
    let frame = fixedStep(elapsed, remainder)
    steps += frame.steps
    remainder = frame.remainder
  }
  equal(steps, 4)
  equal(remainder, 0)
  equal(fixedStep(200).steps, steps)
})

test('fixed step bounds pause catch-up, preserves the fraction and accepts a chosen rate', () => {
  equal(fixedStep(1025), {
    steps: 5,
    dt: 50,
    remainder: 25,
    alpha: 0.5,
    dropped: 15,
  })
  equal(fixedStep(45, 0, 100, 2), {
    steps: 2,
    dt: 10,
    remainder: 5,
    alpha: 0.5,
    dropped: 2,
  })
  equal(fixedStep(0, 25).remainder, 25)
  throws(() => fixedStep(-1))
  throws(() => fixedStep(Infinity))
  throws(() => fixedStep(0, 50))
  throws(() => fixedStep(0, -1))
  throws(() => fixedStep(1, 0, 0))
  throws(() => fixedStep(1, 0, 20, 0.5))
})

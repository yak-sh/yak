// Four timestamps, all in milliseconds: client departure, server receipt,
// server departure, client receipt. Server work isn't network delay.

/** One measured round trip on the store's epoch clock. */
export type ClockSample = {
  offset: number
  delay: number
}

/** NTP's offset and network round trip, or no sample for impossible times. */
export let estimate = (
  departure: number,
  received: number,
  sent: number,
  arrival: number,
): ClockSample | undefined => {
  if (![departure, received, sent, arrival].every(Number.isFinite)) return
  let delay = (arrival - departure) - (sent - received)
  if (arrival < departure || sent < received || delay < 0) return
  return { offset: ((received - departure) + (sent - arrival)) / 2, delay }
}

/** A clock anchored to the local epoch once, then advanced monotonically.
 * Wall-clock adjustments on the page cannot corrupt round-trip measurements. */
export let epoch = (): () => number => {
  let wall = Date.now()
  let start = performance.now()
  return () => wall + performance.now() - start
}

/** A short clock-filter window: prefer the least delayed of the last eight
 * trips. Queued packets don't pull the estimate around; aging admits drift. */
export let clock = (time: () => number = epoch()): {
  now: () => number
  read: () => number
  sample: (departure: number, received: number, sent: number) => void
  reset: () => void
} => {
  let samples: ClockSample[] = []
  let offset = 0
  return {
    read: time,
    now: () => time() + offset,
    sample: (departure, received, sent) => {
      let sample = estimate(departure, received, sent, time())
      if (!sample) return
      samples.push(sample)
      if (samples.length > 8) samples.shift()
      offset = samples.reduce((a, b) => a.delay < b.delay ? a : b).offset
    },
    // Keep the last offset through an outage, but prefer the new route's trips.
    reset: () => {
      samples = []
    },
  }
}

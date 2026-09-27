// One clock for the light and for what the village does through its day.
/** A day in seconds. */
export let DAY = 20 * 60
/** Where the sun is in its day, from 0 to 1. */
export let day = (seconds: number) => ((seconds / DAY) + 0.36) % 1

// UTC instants and floating wall times, converted with explicit IANA zones.
import { TZDateMini } from '@date-fns/tz'

export let zone = (name = 'UTC'): string => {
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(name)) {
    throw new RangeError(`Invalid event time zone: ${name}`)
  }
  new Intl.DateTimeFormat('en', { timeZone: name })
  return name
}

export let floating = (ms: number, name: string): number => {
  if (name == 'UTC') return ms
  let at = new TZDateMini(ms, name)
  return Date.UTC(
    at.getFullYear(),
    at.getMonth(),
    at.getDate(),
    at.getHours(),
    at.getMinutes(),
    at.getSeconds(),
    at.getMilliseconds(),
  )
}

export let zoned = (ms: number, name: string): number => {
  if (name == 'UTC') return ms
  let at = new Date(ms)
  return new TZDateMini(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    at.getUTCHours(),
    at.getUTCMinutes(),
    at.getUTCSeconds(),
    at.getUTCMilliseconds(),
    name,
  ).getTime()
}

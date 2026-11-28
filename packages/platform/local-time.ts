/** The browser's configured time zone, sent with an Operator message. */
export let BROWSER_ZONE: string = 'x-yak-time-zone'

/** Accept a named zone the runtime can use, including aliases and UTC. */
export let timeZone = (value: unknown): string | undefined => {
  if (
    typeof value != 'string' || !/^[A-Za-z][A-Za-z0-9_+/-]{0,79}$/.test(value)
  ) {
    return
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return value
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
  }
}

/** How the Operator talks about instants sent to it by tools and the system. */
export let timePolicy: string =
  'When you speak or write a time, use the time zone that matters. Use the person’s local time for their own times, including when something happened or when they asked to be reminded. For an event or place with its own time zone, use that zone. If the zone differs from the person’s, state the time zone itself beside the time, for example “2:15 p.m. Central Daylight Time.” Use the zone they explicitly ask for. Convert raw UTC timestamps before mentioning them, using the offset for the date in question. If you need a local zone and do not know it, ask. The person’s local clock is private to them.'

/** The clock at the start of this turn, with the date and current offset. */
export let clockItem = (zone: string | undefined, now = Date.now()): string => {
  if (!zone) {
    return `The person’s local time zone is unknown. The current instant for reference is ${
      new Date(now).toISOString()
    }.`
  }
  let at = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'longOffset',
  }).format(now)
  return `The person’s current local time is ${at} (${zone}).`
}

/** The header a caller names one write by, across its sends. */
export let IDEMPOTENCY: string = 'idempotency-key'

/** The header a door adds to a failure already reported at its source. */
export let FILED: string = 'x-yak-filed'

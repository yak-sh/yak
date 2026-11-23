/** What a config passes to @yaks/phone: which lent texter sends, by name
 * (`stash` keeps texts in memory). */
export type Options = {
  sender?: { via: string }
}

/** Provider selection and credentials, passed to that provider's factory. */
export type Transport = {
  via: string
  key?: string
  profile?: string
  user?: string
  number?: string
  tollFree?: boolean
  api?: string
  fetch?: typeof fetch
}

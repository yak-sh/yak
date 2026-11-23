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
  /** the kinds of number a provider that sells them sells here */
  sells?: ('local' | 'toll_free')[]
  api?: string
  /** the only API methods a person's own account may be asked, as the
   * integration they connected it through lists them (@yaks/connections
   * `Integration.methods`) */
  methods?: string[]
  fetch?: typeof fetch
}

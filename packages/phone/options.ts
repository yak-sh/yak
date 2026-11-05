/** What a config passes to @yaks/phone. Secrets are resolved by the host. */
export type Options = {
  sender?: Transport
  door?: Door
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

/** The provider's webhook door and verification key. */
export type Door = {
  /** Defaults to sender.via, then telnyx for existing configurations. */
  via?: string
  /** Defaults to /<via>/webhook. */
  path?: string
  key: string
}

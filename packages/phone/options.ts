// What a config passes to @yaks/phone, read by `./effects` (the sender) and
// `./routes` (the webhook door).
//
// ```json
// { "use": "@yaks/phone",
//   "with": { "sender": { "via": "telnyx",
//                         "key": { "secret": "TELNYX_API_KEY" },
//                         "profile": "yaks.app" },
//             "door": { "key": "RA8+wmOD4ivICcJNznDMWuA8DoM+StbPtYr0srTKaKI=" } } }
// ```
//
// `{"secret": "NAME"}` anywhere is that secret's value when it is read, so
// the file holds no key.

/** What a config passes to @yaks/phone. */
export type Options = {
  /** the transport outbound texts go through; with none, none are sent */
  sender?: Transport
  /** where texts arrive; with none, no door */
  door?: Door
}

/** A sender by name: `telnyx` or `stash`. */
export type Transport = {
  via: 'telnyx' | 'stash'
  /** Telnyx's API key */
  key?: string
  /** Telnyx's messaging profile, by name */
  profile?: string
  /** the API's base URL, to point a test at a stand-in */
  api?: string
}

/** The webhook door: where the provider posts, and its signing key. */
export type Door = {
  /** the path (default `/telnyx/webhook`) */
  path?: string
  /** Telnyx's webhook public key, base64 (Mission Control, Keys & Credentials) */
  key: string
}

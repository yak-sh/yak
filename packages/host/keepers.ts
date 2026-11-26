/** Where a key goes besides the graph's own vault: a keeper puts a value at
 * one of its own places (a password manager's item, a Worker's secret). A
 * plugin lends one by name, and whoever asks for a key names the keepers and
 * places it goes to as data (@yaks/connections `connection.keep`). The host
 * owns the keeper's own credentials. */

/** One place a key is kept, as an ask names it: the keeper's name, and the
 * keeper's own address for the key there. */
export type Place = { via: string; at: string }

/** Puts a value at a place of its own, resolving once it is there and
 * rejecting with why it is not. Putting the same value again is harmless. */
export type Keeper = {
  keep: (at: string, value: string) => Promise<void>
  /** Why it cannot keep anything yet, such as its own credential not set. */
  waiting?: () => string | undefined
}

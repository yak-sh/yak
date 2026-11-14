// Addresses, and the one rule about them worth writing down: the canonical
// form of an address at your own domain.
//
// Everyone else's domain is nobody's business but theirs — `ana@example.com`
// passes through this file untouched, because only the mail server behind
// example.com knows whether that is the same mailbox as `Ana@example.com`. At
// your domain you do know, and knowing is worth something: canonicalize on the
// way in and a club's address book cannot end up holding two rows for one
// person.
//
// The canonical form lowercases the local part and drops underscores. The
// lowercase is the ordinary courtesy; the underscore is a hard-won fact —
// Cloudflare Email Routing rejects an underscore in the local part at RCPT,
// upstream of anything you deploy, so a letter to `book_club@…` bounces
// whatever your routing rules say. Dropping it on the way in is the only place
// the fix works.
//
// Every function here is curried domain-first, so an app applies its own
// domain once and passes the result around:
// `let mine = canon('books.example')`.

/** An address split at its one `@`, or `null` when it has none or several. */
export let parts = (address: string): [string, string] | null => {
  let [local, domain, ...extra] = address.trim().split('@')
  return local && domain && !extra.length ? [local, domain] : null
}

// An address as a sending API takes one: the address form of WHATWG's
// `<input type=email>`, ASCII and unquoted, whose local part neither starts,
// ends nor doubles a dot, at a domain of two labels or more.
let LOCAL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
let LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/**
 * Whether a typed address is one a letter can be sent to, as a provider such
 * as Resend checks it before taking a letter. Ask before sending, so a typo
 * is the writer's to fix rather than a send that fails.
 *
 * ```ts
 * import { sendable } from '@yaks/mail'
 * sendable('ana@books.example') // true
 * sendable('ana@books')         // false
 * sendable('ana@@books.example') // false
 * ```
 */
export let sendable = (address: string): boolean => {
  let split = parts(address)
  if (!split || address != address.trim() || address.length > 254) return false
  let labels = split[1].split('.')
  return split[0].length <= 64 && LOCAL.test(split[0]) &&
    labels.length > 1 && labels.every((l) => LABEL.test(l))
}

/** An address at a domain: `address('ana', 'books.example')`. */
export let address = (local: string, domain: string): string =>
  `${local}@${domain}`

/**
 * The local part of an address at `domain`, or `null` for an address anywhere
 * else. The domain is compared case-insensitively; the local part comes back
 * as it was written.
 *
 * ```ts
 * import { local } from '@yaks/mail'
 * local('books.example')('Ana@Books.Example') // 'Ana'
 * local('books.example')('ana@elsewhere.com') // null
 * ```
 */
export let local = (domain: string): (address: string) => string | null => {
  let mine = domain.trim().toLowerCase()
  return (address: string): string | null => {
    let split = parts(address)
    return split && split[1].toLowerCase() == mine ? split[0] : null
  }
}

/** Whether an address is at `domain`. */
export let at = (domain: string): (address: string) => boolean => {
  let get = local(domain)
  return (address) => get(address) != null
}

/**
 * The canonical, deliverable form of an address at `domain`: the local part
 * lowercased with its underscores dropped, at the domain as configured. An
 * address at any other domain is returned as it was given — canonicalizing
 * somebody else's domain is a guess, and a guess here misdelivers mail.
 *
 * ```ts
 * import { canon } from '@yaks/mail'
 * let mine = canon('books.example')
 * mine('Book_Club@Books.Example') // 'bookclub@books.example'
 * mine('ana@elsewhere.com')       // 'ana@elsewhere.com'
 * ```
 */
export let canon = (domain: string): (raw: string) => string => {
  let mine = domain.trim().toLowerCase()
  let get = local(mine)
  return (raw) => {
    let one = get(raw)
    return one == null
      ? raw
      : address(one.toLowerCase().replace(/_/g, ''), mine)
  }
}

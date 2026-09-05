// Addresses, and the one rule about them worth writing down: the CANONICAL
// form of an address at your own domain.
//
// Everyone else's domain is nobody's business but theirs — `ana@example.com`
// passes through this file untouched, because only the mail server behind
// example.com knows whether that is the same mailbox as `Ana@example.com`. At
// YOUR domain you do know, and knowing is worth something: canonicalize on the
// way in and a club's address book cannot end up holding two rows for one
// person.
//
// The canonical form lowercases the local part and drops underscores. The
// lowercase is the ordinary courtesy; the underscore is a hard-won fact —
// Cloudflare Email Routing refuses an underscore in the local part at RCPT,
// upstream of anything you deploy, so a letter to `book_club@…` bounces
// whatever your routing rules say. Shedding it at the door is the only place
// the fix works.
//
// Everything here is curried domain-first, so an app binds its own domain once
// and passes the result around: `let mine = canon('books.example')`.

/** An address split at its one `@`, or `null` when it has none or several. */
export let parts = (address: string): [string, string] | null => {
  let [local, domain, ...extra] = address.trim().split('@')
  return local && domain && !extra.length ? [local, domain] : null
}

/** An address at a domain, spelled: `address('ana', 'books.example')`. */
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
 * somebody else's namespace is a guess, and a guess here misdelivers mail.
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

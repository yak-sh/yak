// What only a person may do, and an agent may only ask for: the acts that
// cannot be taken back. Each is two steps. The agent's tool takes the step
// that can be undone (app_delete puts an app in the trash), or none at all,
// and asks: it mails the space's owner a letter whose link carries an hour's
// ticket. The act is the owner's press on the page that link opens, signed in
// on the web (identity.ts `confirming`), at the one door every kind shares:
// `/space/<slug>/confirm/<kind>/<target>`.
//
// A kind is data, declared beside what it acts on (erase.ts `trashedApp`,
// numbers.ts `heldNumber`): how its target is found again, what the person
// types back, what the letter and the page say goes, and the act. An act that
// cannot be undone is one more kind, never one more page.
//
// A space's own deletion keeps its door (identity.ts `closing`), because it
// is two acts there: its owner may put it in the trash by typing its name,
// and only a ticket erases it.
import { apex, type Host } from '@yaks/platform/host'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { opened, seal } from './lib/token.ts'
import { mail } from './mail.ts'
import type { Who } from './session.ts'
import { refuse } from './tool.ts'

// An hour to walk over to the inbox and read the letter. Longer than a
// sign-in code's ten minutes, because nobody is standing at the form waiting
// for this one, and short enough that a link left in a mailbox stops being a
// live wire the same day. Unconfirmed, it simply lapses: nothing was written
// when it was minted, so nothing has to be swept when it dies.
export let LIFE = 60 * 60_000

/** One act a person confirms, on a target found again at the door. */
export type Kind<T> = {
  /** The name its door and ticket carry. */
  kind: string
  /** Whether this press keeps the target recoverable in the trash. */
  reversible?: boolean
  /** The target, if this space still holds it. */
  find: (dir: Directory, space: Space, target: string) => Promise<T | null>
  /** What the person types back when they came without the ticket. */
  typed: (t: T) => string
  /** The letter's subject and the page's title: a question. */
  title: (t: T) => string
  /** Where things stand until they press. */
  until: (t: T) => string
  /** Why it cannot be done now, or nothing. */
  stop?: (t: T) => string
  /** What it destroys, in the words the letter and the page both say. */
  lines: (space: Space, t: T, env: Host) => string[]
  /** The button's words. */
  press: (t: T) => string
  /** The act, answering what was done. */
  act: (
    env: Env,
    dir: Directory,
    space: Space,
    t: T,
    who: Who,
  ) => Promise<string>
}

/** What the letter carries: which act, on what, in which space, for whom,
 * and the unix second it dies. The kernel signs it; nobody else can mint
 * one. */
export type Ticket = {
  kind: string
  space: string
  target: string
  person: string
  exp: number
}

export let ticket = (
  kind: string,
  space: Space,
  target: string,
  person: string,
  secret: string,
) =>
  seal(
    'confirm',
    {
      kind,
      space: space.eid,
      target,
      person,
      exp: Math.floor((Date.now() + LIFE) / 1000),
    } satisfies Ticket,
    secret,
  )

export let ticketed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Ticket | null> => {
  let t = await opened<Ticket>('confirm', token, secret)
  return t && typeof t.kind == 'string' && typeof t.space == 'string' &&
      typeof t.target == 'string' && typeof t.person == 'string' &&
      typeof t.exp == 'number' && t.exp * 1000 > now
    ? {
      kind: t.kind,
      space: t.space,
      target: t.target,
      person: t.person,
      exp: t.exp,
    }
    : null
}

/** The door, and the door with a ticket in hand: the address the letter
 * carries and the page posts back to. */
export let door = (
  slug: string,
  kind: string,
  target: string,
  token?: string,
  env: Host = {},
) =>
  `https://${apex(env)}/space/${slug}/confirm/${kind}/${target}` +
  (token ? `?t=${encodeURIComponent(token)}` : '')

let bullets = (lines: string[]) => lines.map((l) => `  - ${l}`).join('\n')

export let letter = <T>(
  k: Kind<T>,
  space: Space,
  t: T,
  link: string,
  env: Host = {},
) => ({
  subject: k.title(t),
  body: `Your assistant asked, in ${space.slug}.${apex(env)}: ${k.title(t)}

Nothing has happened yet. ${k.until(t)} Nothing changes unless you open this
link, and it only works for the next hour:

${link}

${
    k.reversible
      ? 'It can be restored from the trash within 30 days. What stops:'
      : 'It cannot be undone. It destroys:'
  }

${bullets(k.lines(space, t, env))}

If you did not ask for this, ignore this letter and nothing happens at all.`,
})

/**
 * An agent's whole part in an act it cannot do: the letter to the address
 * the caller signs in with (never one the agent named), carrying the ticket.
 * Answers what the agent tells the person.
 */
export let requested = async <T>(
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
  k: Kind<T>,
  target: string,
  t: T,
): Promise<string> => {
  if (!env.SESSION_SECRET) {
    throw new Error('the platform cannot sign a confirmation link here')
  }
  let to = await dir.emailAt(person)
  if (!to) throw refuse('missing', 'we have no address to write to you at')
  let link = door(
    space.slug,
    k.kind,
    target,
    await ticket(k.kind, space, target, person, env.SESSION_SECRET),
    env,
  )
  await mail(env)({ to, ...letter(k, space, t, link, env) })
  return `nothing has happened yet. ${k.until(t)} An assistant cannot do ` +
    'this: a letter is on its way to the address they sign in with, ' +
    'carrying a link that does it. It lasts an hour, and opening it asks ' +
    'them once more. Tell them to check their email. What it would ' +
    `destroy:\n${bullets(k.lines(space, t, env))}`
}

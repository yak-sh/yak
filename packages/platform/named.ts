/**
 * What a person is called, as their own Operator keeps it. Signing in by an
 * emailed code asks nobody's name, so until a person types one on their
 * profile, the directory calls them by the front of their address
 * (`thecompanygardener`), and nothing on yaks.app says who they are. Their
 * Operator is where they say it: each turn it is told when it does not know
 * their name ({@link nameItem}), and `name_set` keeps the name they give
 * ({@link nameSet}) as their `doc.title`, the name the profile page edits.
 *
 * ```ts
 * import { unnamed } from '@yaks/platform/named'
 * import { equal } from '@yaks/testing'
 *
 * equal(unnamed('thecompanygardener', 'thecompanygardener@gmail.com'), true)
 * equal(unnamed('Erik', 'thecompanygardener@gmail.com'), false)
 * ```
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'
import type { Dir } from './located.ts'

/** Whether a title says nothing the address does not: none, an address, or
 * the front of their own as signing in writes it (`nameOf`, lower case). */
export let unnamed = (title: string | undefined, email: string | undefined) =>
  !title?.trim() || title.includes('@') ||
  title.trim() == (email ?? '').trim().toLowerCase().split('@')[0]

let person = async (dir: Dir, eid: string) => {
  let [me] = await dir.read(
    line`.entity.eid=${eid}&.fields=entity.eid,doc.title,email.address`,
  ) as (Bundle & { doc?: { title?: string }; email?: { address?: string } })[]
  return { title: me?.doc?.title, email: me?.email?.address }
}

/** The line each turn of a person's own Operator is given when it does not
 * know their name, none when it does. */
export let nameItem = async (dir: Dir, eid: string) => {
  let { title, email } = await person(dir, eid)
  if (!unnamed(title, email)) return
  return `You don't know the name of the person you are talking with: their ` +
    `account calls them ${title || email || 'nothing'}. When they say their ` +
    `name or sign with one, keep it with name_set.`
}

/** The Operator's `name_set`: the name the person you work for gives. */
export let nameSet = (
  open: () => Dir | Promise<Dir>,
  eid: string,
): Tool => ({
  name: 'name_set',
  title: 'Keep their name',
  description:
    'Keep the name the person you work for goes by, in their own words ("I\'m Erik", or a sign-off): it is the name every space they are in shows them by, and the one the platform knows them by. Only their own name, never someone else\'s.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'their name as they give it, such as Erik Unruh',
      },
    },
    required: ['name'],
  },
  run: async (args) => {
    let name = String(args.name ?? '').trim().slice(0, 60)
    if (!name || name.includes('@')) return 'Give their name, not an address.'
    let dir = await open()
    await dir.apply([{ entity: { eid }, doc: { title: name } }])
    return `Kept: they go by ${name}.`
  },
})

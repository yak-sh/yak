import type { Bundle } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'
import type { Dir } from './located.ts'

/** How the directory learned the title on a person's row. */
export let NAME_SOURCES = [
  'fallback',
  'invite',
  'email',
  'google',
  'stripe',
  'calendar',
  'said',
] as const

export type NameSource = typeof NAME_SOURCES[number]

export type PersonName = {
  doc?: { title?: string | null }
  email?: { address: string }
  person_name?: { source?: NameSource }
}

export let fallbackName = (email = '') =>
  email.trim().toLowerCase().split('@')[0]

/** A supplied display name, with the same length limit as Profile. */
export let suppliedName = (value: unknown) => {
  let name = typeof value == 'string' ? value.trim() : ''
  return name && !name.includes('@') && !/[\r\n]/.test(name)
    ? name.slice(0, 60)
    : null
}

/** A title someone supplied. An older title equal to the email's local part
 * was the sign-in fallback unless its source was recorded. */
export let learnedName = (row: PersonName, email = row.email?.address) => {
  let title = suppliedName(row.doc?.title)
  let source = row.person_name?.source
  return source == 'fallback' || (!source && title == fallbackName(email))
    ? null
    : title
}

/** The title and its source move together. A person's own words can change
 * their name. A provider fills a missing name or replaces an invitation's. */
export let personNamePatch = (
  row: PersonName,
  value: unknown,
  source: NameSource,
  email = row.email?.address,
): { doc?: { title: string }; person_name?: { source: NameSource } } => {
  if (source == 'said' && value === null) {
    let title = fallbackName(email)
    return title == row.doc?.title && row.person_name?.source == 'fallback'
      ? {}
      : { doc: { title }, person_name: { source: 'fallback' } }
  }
  let title = source == 'fallback' ? fallbackName(email) : suppliedName(value)
  if (!title) return {}
  if (
    source != 'said' && learnedName(row, email) &&
    !(row.person_name?.source == 'invite' && source != 'fallback' &&
      source != 'invite')
  ) return {}
  if (title == row.doc?.title && source == row.person_name?.source) return {}
  return { doc: { title }, person_name: { source } }
}

let personAt = async (dir: Dir, person: string) =>
  (await dir.read(
    line`.entity.eid=${person}&.person&?doc&?email&?person_name&!trashed`,
  ))[0] as Bundle & PersonName | undefined

/** Conditions for writing a name based on the current title and source. */
export let nameVersion = (row: PersonName) => ({
  doc: { title: token(row.doc?.title ?? null) },
  person_name: { source: token(row.person_name?.source ?? null) },
})

/** Update the name of an existing person. Provider names carry their address
 * where available, so a name from a different account cannot be applied. */
export let keepName = async (
  dir: Dir,
  person: string,
  name: string | null,
  source: NameSource,
  { email, by, via }: { email?: string; by?: string; via?: string } = {},
): Promise<string | null> => {
  for (;;) {
    let row = await personAt(dir, person)
    if (!row || (email && row.email?.address != email.trim().toLowerCase())) {
      return null
    }
    let patch = personNamePatch(row, name, source)
    if (!patch.doc) return learnedName(row)
    try {
      await dir.apply([{
        entity: row.entity,
        ...patch,
        $was: {
          ...nameVersion(row),
          email: { address: token(row.email?.address ?? null) },
        },
        ...by ? { $actor: { by, ...via ? { via } : {} } } : {},
      }])
      return patch.doc.title
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
}

/** Whether a legacy title just echoes the address. */
export let unnamed = (title: string | undefined, email: string | undefined) =>
  !learnedName({ doc: { title } }, email)

/** What each turn knows of the stored name. Only the first reply in the
 * person's own conversation is invited to ask for it. */
export let nameItem = async (
  dir: Dir,
  person: string,
  first?: () => Promise<boolean>,
) => {
  let row = await personAt(dir, person)
  if (!row) return
  let name = learnedName(row)
  if (name) {
    return `Their saved display name is ${
      JSON.stringify(name)
    }. Use it as their name.`
  }
  return await first?.()
    ? 'Their name is unknown. In your first reply, ask once, naturally, what they go by, alongside helping with what they came for. If they already told you their name, save it instead.'
    : 'Their name is unknown. When they tell you their own name, keep it with name_set.'
}

/** The Operator's name_set: the name the person it works for gives. */
export let nameSet = (
  open: () => Dir | Promise<Dir>,
  person: string,
  by?: string,
): Tool => ({
  name: 'name_set',
  title: 'Keep their name',
  description:
    'Keep the name the person you are talking with explicitly gave for themselves, in their own words or sign-off.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Their name as they give it.' },
    },
    required: ['name'],
  },
  run: async (args, context) => {
    let name = suppliedName(args.name)
    if (!name) return 'Give their name, not an address.'
    let kept = await keepName(await open(), person, name, 'said', {
      by,
      via: context?.session,
    })
    return kept
      ? `Kept: they go by ${kept}.`
      : 'This account has no person to name.'
  },
})

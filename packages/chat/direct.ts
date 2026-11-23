import type { Said } from './mod.ts'

type Space = { eid: string; slug: string; trashed?: unknown }
type Seat<S> = { own: boolean; role: string; space: S }

/** A direct message held until taken, pinning its destination across retries. */
export type DirectMessage = { said: Said; person?: string; space?: string }

type Direct<S> = {
  person: string | undefined
  seats: (person: string) => Promise<Seat<S>[]>
  reserve: (person: string, space: S) => Promise<boolean>
  forward: (person: string, space: S, said: Said) => Promise<void>
  explain: (
    why: 'link' | 'empty' | 'usage' | 'access' | 'space',
  ) => Promise<void>
  done: () => Promise<void>
}

let words = (text: string) => {
  let command = /^!space(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i.exec(text)
  return command
    ? { slug: command[1]?.toLowerCase() ?? '', text: command[2] ?? '' }
    : { text }
}

let destination = <S extends Space>(
  seats: Seat<S>[],
  eid?: string,
  slug?: string,
) => {
  let open = seats.filter(({ space }) => !space.trashed)
  if (eid) return open.find(({ space }) => space.eid == eid)?.space
  if (slug != null) return open.find(({ space }) => space.slug == slug)?.space
  return (open.find((s) => s.own) ?? open.find((s) => s.role == 'owner') ??
    open.find((s) => s.role == 'editor') ?? open[0])?.space
}

/** Resolve a queued DM and carry it to the sender's space. A racing handoff
 * that reserved a destination first is reread by the host. */
export let carryDirect = async <S extends Space>(
  dm: DirectMessage,
  { person, seats, reserve, forward, explain, done }: Direct<S>,
): Promise<'reread' | void> => {
  if (!person || (dm.person && dm.person != person)) return explain('link')
  let { slug, text } = words(dm.said.text)
  if (!text.trim()) {
    await explain(slug == null ? 'empty' : 'usage')
    return done()
  }
  let space = destination(await seats(person), dm.space, slug)
  if (!space) {
    let wrong = slug != null && !dm.space
    await explain(wrong ? 'access' : 'space')
    if (wrong) await done()
    return
  }
  if (!dm.space && !await reserve(person, space)) return 'reread'
  await forward(person, space, { ...dm.said, text })
  await done()
}

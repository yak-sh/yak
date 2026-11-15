// The session bus's intake: words given a session from outside it, a
// person's by a page, a channel or a conversation tool, taken in as its next
// input once each, with how they came and what came with them. What is
// addressed to a session in the graph is delivered by ./bus.ts.
import type { ApplyOpts, Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { type Attached, attachmentRows } from '@yaks/blob/attachment'
import { and, eq, fields, present } from '@yaks/query'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** Words given a session from outside it, as its next input ({@link take}):
 * whose they are (`by`) and, when someone else wrote them for that person,
 * who did (`from`); what names them wherever they are given again (`id`),
 * which is the item they came in (`item`, such as a request) unless the
 * caller names them itself; the channel they came by and the framing said
 * before them, which `body` starts with; the files that came with them; the
 * model chosen to answer them (`using`); and what the host keeps beside them
 * (`with`). Words the platform wrote, never a person's, are `system`. */
export type Intake = {
  session: Eid
  body: string
  by: Eid
  id?: string
  item?: Eid
  from?: string
  channel?: { name: string; framing?: string }
  files?: Attached[]
  using?: Comp
  system?: boolean
  with?: Record<string, Comp>
}

/** The input the words named `id` become in the session that takes them
 * in: one id, so a request and its line are one, and giving them again
 * writes nothing. The words it is derived from are the ones its first rows
 * were named by. */
export let inputOf = (id: string): Eid => derivedEid('operator-input|' + id)

/** The rows that give a session these words: its input, linked back to the
 * item it came in (`taken{item}`), and each file's attachment to that item, or
 * to the input where no item names them (@yaks/blob/attachment). */
export let intake = (words: Intake): Bundle[] => {
  let { session, item, from, channel, using } = words
  let named = words.id ?? item
  let eid = named ? inputOf(named) : crypto.randomUUID()
  return [
    {
      entity: { eid },
      entry: { session, ...from ? { from } : {} },
      ...item ? { taken: { item } } : {},
      content: { body: words.body },
      ...channel ? { channel } : {},
      ...using ? { using } : {},
      ...words.system ? { system: {} } : {},
      ...words.with,
      $actor: { by: words.by, via: session },
    },
    ...attachmentRows(item ?? eid, words.files ?? []),
  ]
}

/** Give a session words ({@link intake}), with what the host writes `beside`
 * them in the same batch: the input's id, and whether this wrote it. Named
 * words already taken in write nothing, `beside` included, however many
 * times or at once they are given again. */
export let take = async (
  g: Pick<Graph, 'get' | 'apply'>,
  words: Intake,
  beside: Bundle[] = [],
  options: ApplyOpts = {},
): Promise<{ input: Eid; fresh: boolean }> => {
  let [line, ...files] = intake(words)
  let input = line.entity.eid
  if (
    (words.id ?? words.item) && (await g.get([input], ['entry']))[0]?.entry
  ) {
    return { input, fresh: false }
  }
  try {
    await g.apply([
      ...beside,
      { ...line, $was: { entry: { session: token(null) } } },
      ...files,
    ], options)
  } catch (error) {
    if (error instanceof Stale && error.eid == input) {
      return { input, fresh: false }
    }
    throw error
  }
  return { input, fresh: true }
}

/** The session a task's next words go to: the newest it holds
 * (`contains`), if any. */
export let taskSession = async (
  g: Pick<Graph, 'read' | 'get'>,
  task: Eid,
): Promise<Eid | undefined> => {
  let links = await g.read(and(
    present('contains'),
    eq('edge.from', task),
    fields('edge.to'),
  ))
  let held = await g.get(
    links.map((b) => String(comp(b, 'edge').to)),
    ['session', 'created'],
  )
  return held.filter((b) => b?.session)
    .sort((a, b) =>
      String(comp(a, 'created').at).localeCompare(String(comp(b, 'created').at))
    ).at(-1)?.entity.eid
}

// Context belongs to the input it enriches. Freeze it before the first ask,
// so tool rounds and replacement workers send the same admitted words.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Item } from '@yaks/model'
import { kindOf, seqOf } from './state.ts'

export let inputItems = (entry: Bundle): Item[] =>
  (entry.input_context as Comp)?.items as Item[] ?? []

export let prepareInput = async (
  g: Graph,
  session: string,
  window: Bundle[],
  entries: Bundle[],
  prepare: (entry: Bundle, entries: Bundle[]) => Item[] | Promise<Item[]>,
): Promise<void> => {
  let byId = new Map(entries.map((b) => [b.entity.eid, b]))
  let sent = Math.max(
    0,
    ...entries.filter((b) =>
      (b.entry as Comp)?.session == session &&
      (b.ask || (b.output && !b.notice &&
        (!(b.output as Comp).source || (b.output as Comp).source == session)))
    ).map((b) => {
      let through = byId.get(String((b.ask as Comp)?.through))
      return seqOf(through ?? b)
    }),
  )
  for (let input of window) {
    if (
      (input.entry as Comp)?.session != session ||
      kindOf(input) != 'input' || input.prompt || input.notice || input.meta ||
      input.reasoning || input.checkpoint || input.cancel ||
      input.input_context || seqOf(input) <= sent
    ) continue
    let items = await prepare(input, entries)
    let saved = await g.apply([{
      entity: input.entity,
      input_context: { items },
      $was: {
        content: { body: token((input.content as Comp)?.body ?? null) },
        entry: { session: token((input.entry as Comp)?.session ?? null) },
        input_context: { items: null },
      },
    }], { trusted: true })
    input.input_context = saved.find((b) => b.entity.eid == input.entity.eid)
      ?.input_context
  }
}

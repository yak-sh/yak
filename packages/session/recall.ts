// What the configured person said, kept and decided before on the subject of
// their words (@yaks/memory/earlier), for every door that hands those words
// to the agent answering them: the prompt hook (./routes.ts), and a comment
// or letter of theirs the bus owes a session (./bus.ts), or a session is
// started on (./start.ts). What an agent writes is answered the same way by
// @yaks/memory/graph, keyed on what it wrote. The recall gets RECALL ms; a slower one is left
// out rather than holding the words, and one that fails is reported and left
// out the same way.

import { earlier } from '@yaks/memory/earlier'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Host, Meaning } from '@yaks/host'
import { words } from './listen.ts'

/** How long words wait for what was said before, before going without it. */
export let RECALL = 700

/** What a host recalls with: its person, and its ranking by meaning. */
export type Recalling = {
  graph: Graph
  config?: { person?: string }
  meaning?: Meaning
  report?: Host['report']
}

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** What sets beside a person's words what they said before. */
export type Beside = <T extends { item: Bundle; line: string }>(
  owed: T[],
) => Promise<T[]>

/** A host's recall. */
export type Recall = {
  /** what the host's person (or `by`) said before `before` on the subject of
   * `words` */
  said: (words: string, before: string, by?: string) => Promise<string>
  /** these items, with it under the line of each one the person wrote where
   * there is any */
  beside: Beside
}

/** A host's recall, each given `wait` ms; a null `wait` waits as long as it
 * takes. */
export let recall = (
  host: Recalling,
  wait: number | null = RECALL,
): Recall => {
  let person = async () => {
    let said = host.config?.person
    return said
      ? (await host.graph.address([said])).get(said) ?? said
      : undefined
  }
  let said = async (text: string, before: string, by?: string) => {
    try {
      return await earlier(host.graph, {
        person: by ?? await person(),
        words: text,
        before,
        meaning: host.meaning,
        wait,
      })
    } catch (error) {
      if (!host.report) throw error
      await host.report(error)
      return ''
    }
  }
  let beside: Beside = async (owed) => {
    let theirs = (o: { item: Bundle }) => comp(o.item, 'created').by
    if (!host.config?.person || !owed.some(theirs)) return owed
    let by = await person()
    return Promise.all(owed.map(async (o) => {
      if (theirs(o) != by) return o
      let found = await said(
        words(o.item),
        String(comp(o.item, 'created').at),
        by,
      )
      return found ? { ...o, line: `${o.line}\n\n${found}` } : o
    }))
  }
  return { said, beside }
}

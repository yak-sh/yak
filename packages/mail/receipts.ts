// A provider's signed delivery receipt updates the same neutral letter the
// sender wrote. A missing letter is an error to retry: an Operator may still be
// committing it when the provider calls back. The provider's plugin owns the
// route that verifies a receipt (@yaks/resend `./routes`).
import type { Comp, Graph } from '@yaks/graph'

/** Apply a provider-neutral receipt to the same recorded letter. */
export let receipted = async (
  graph: Pick<Graph, 'get' | 'apply'>,
  found: { letter: string; id: string },
): Promise<void> => {
  let [letter] = await graph.get([found.letter])
  if (!letter?.mail) {
    throw new Error('The delivery receipt awaits its recorded letter')
  }
  let prior = (letter.mail as Comp).message_id
  if (prior && prior != found.id) {
    throw new Error('The receipt disagrees with the recorded Message-ID')
  }
  if (!prior) {
    await graph.apply([{
      entity: letter.entity,
      mail: { message_id: found.id },
    }], { trusted: true })
  }
}

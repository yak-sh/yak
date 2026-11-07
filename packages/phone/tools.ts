// What an agent may ask for here: the `@yaks/phone/tools` entry point, the
// implementation behind `text_send` in ./vocab.json. It writes a text that
// asks to be sent (`deliver{to}`), and ./effects.ts hands it to the texter
// the config's `sender.via` names, so this file never talks to a provider.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'
import { CallError } from '@yaks/tools/errors'
import { consentEid, mobile } from './mod.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

// Who `to` names: an id, or a number someone here wears.
let reached = async (graph: Graph, to: string): Promise<Eid | undefined> => {
  let number = /[a-z]/i.test(to) ? null : mobile(to)
  if (number) {
    let [found] = await graph.read(
      `.phone.number=${JSON.stringify(number)}&.fields=phone.number`,
    )
    return found?.entity.eid
  }
  return (await graph.get([to], ['phone']))[0]?.entity.eid
}

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  text_send: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let to = str(args.to).trim()
    let body = str(args.body).trim()
    if (!body) throw new CallError('body', 'a text needs words — say --body')
    let person = to ? await reached(graph, to) : undefined
    let [row] = person ? await graph.get([person], ['phone']) : []
    let [consent] = person
      ? await graph.get([consentEid(person)], ['sms_consent'])
      : []
    if (!(row?.phone as Comp | undefined)?.number) {
      throw new CallError('to', `nobody here has a phone number at ${to}`)
    }
    if (!consent?.sms_consent) {
      throw new CallError(
        'to',
        `${to} has not agreed to texts: only someone with an sms_consent is texted`,
      )
    }
    return [{
      entity: { eid: '$text' },
      doc: { body },
      text: {},
      deliver: { to: person },
    }]
  },
})

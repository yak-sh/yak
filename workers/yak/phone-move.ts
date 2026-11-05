// One message shape beside the Operator's conversation link. The old source
// columns stay declared until dormant Operators have been reached; only this
// migration reads them. They are never written on new texts.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Rule } from './mover.ts'

export let phoneMove = (row: Bundle): Bundle[] => {
  let own = row.operator_text as Comp | undefined
  if (own?.from == null) return []
  let fields = ['from', 'to', 'at', 'message_id']
  return [{
    entity: row.entity,
    text: {
      ...Object.fromEntries(
        fields.flatMap((name) => own[name] == null ? [] : [[name, own[name]]]),
      ),
      via: 'voipms',
    },
    operator_text: Object.fromEntries(fields.map((name) => [name, null])),
  }]
}

/** The private Operator graph is migrated in bounded writes during its work,
 * never in Durable Object boot. A reply lookup finishes pending batches first. */
export let phoneTexts = async (g: Graph) => {
  for (;;) {
    let rows = await g.read('.operator_text.from&.limit=50')
    if (!rows.length) return
    await g.apply(rows.flatMap(phoneMove), { trusted: true, stamp: false })
  }
}

/** Existing app texts were all carried by Telnyx. Keep their identities and
 * opaque receipts, naming the transport so new providers cannot collide. */
export let phoneRule: Rule = {
  mark: 'yak/store/phone-provider/1',
  core: ['text'],
  find: '.text&!text.via',
  live: 'all',
  move: (row) => [{ entity: row.entity, text: { via: 'telnyx' } }],
}

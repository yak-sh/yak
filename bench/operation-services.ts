/** Connection declarations, local mail requests and platform scans through
 * production doors. Mail is queued in an isolated graph, never delivered to
 * an external transport; these figures do not represent SMTP delivery. */
import type { Operation } from './operation-commands.ts'
import type { OperationContext } from './operation-local.ts'

export let SERVICE_FAMILIES = [
  'connection-need',
  'connection-list',
  'mail-send',
  'mail-reply',
  'mail-show',
  'mail-check',
  'visualize-anatomy',
  'visualize-activity',
]
export let serviceOperations = async (
  c: OperationContext,
): Promise<Operation[]> => {
  let { graph, PERSON, PROJECT, TARGET, fresh, saved, includes } = c
  let letter = crypto.randomUUID()
  await graph.apply([
    { entity: { eid: PERSON }, email: { address: 'reader@operation.invalid' } },
    {
      entity: { eid: letter },
      mail: {
        from: 'sender@operation.invalid',
        to: 'reader@operation.invalid',
        message_id: '<operation-letter@operation.invalid>',
        target: PERSON,
      },
      doc: {
        title: 'Operation incoming letter',
        body: 'Populated local thread body',
      },
    },
  ])
  let activityTimer: ReturnType<typeof setInterval> | undefined
  return [
    {
      family: 'connection-need',
      tool: 'connection_need',
      command: ['connection', 'need'],
      prepare: async () => {
        await graph.apply([{
          entity: { eid: TARGET },
          doc: { body: fresh('connection app') },
        }])
      },
      args: () => ({
        app: TARGET,
        owner: PERSON,
        integration: fresh('service'),
        hosts: ['service.operation.invalid'],
        binding: 'OPERATION',
      }),
      verify: async (text, input) => {
        includes(text, String(input.integration))
        await saved(`.connection.owner=${PERSON}`, String(input.integration))
        await saved(`.uses.binding=OPERATION ?edge`, TARGET)
      },
    },
    {
      family: 'connection-list',
      tool: 'connection_list',
      command: ['connection', 'list'],
      args: () => ({ owner: PERSON }),
      verify: (text) => {
        includes(text, 'service')
        includes(text, 'needed')
      },
    },
    {
      family: 'mail-send',
      tool: 'mail_send',
      command: ['mail', 'send'],
      args: () => ({
        to: 'recipient@operation.invalid',
        subject: fresh('mail subject'),
        body: fresh('mail body'),
        about: PROJECT,
      }),
      verify: async (text, input) => {
        includes(text, String(input.body))
        await saved(
          `.mail .doc.title="${input.subject}" ?deliver`,
          String(input.body),
        )
      },
    },
    {
      family: 'mail-reply',
      tool: 'mail_reply',
      command: ['mail', 'reply'],
      args: () => ({ letter, body: fresh('reply body') }),
      verify: async (text, input) => {
        includes(text, String(input.body))
        await saved(
          `.mail.reply_to=${letter} ?doc ?deliver`,
          String(input.body),
        )
        await saved(`.subscription.actor=${PERSON} ?archived`, 'archived')
      },
    },
    {
      family: 'mail-show',
      tool: 'mail_show',
      command: ['mail', 'show'],
      prepare: async () => {
        for (let row of await graph.read(`.subscription.actor=${PERSON}`)) {
          await graph.apply([{ entity: row.entity, opened: null }])
        }
      },
      args: () => ({ letter }),
      verify: async (text) => {
        includes(text, 'Populated local thread body')
        includes(text, 'Thread')
        await saved(`.subscription.actor=${PERSON} ?opened`, 'opened')
      },
    },
    {
      family: 'mail-check',
      tool: 'mail_check',
      command: ['mail', 'check'],
      args: () => ({}),
      verify: (text) =>
        includes(text, 'every letter that arrived carries a sender'),
    },
    {
      family: 'visualize-anatomy',
      tool: 'visualize_anatomy',
      command: ['visualize', 'anatomy'],
      args: () => ({ group: 'tools', limit: 500 }),
      verify: (text) => {
        includes(text, 'task_new')
        includes(text, 'selection')
        includes(text, 'coverage')
      },
    },
    {
      family: 'visualize-activity',
      tool: 'visualize_activity',
      command: ['visualize', 'activity'],
      // Drive this process's channel while either HTTP door is subscribed.
      // A capture without observed work is not proof of a waiting operation.
      prepare: () => {
        activityTimer = setInterval(() => {
          Promise.resolve(graph.read(`.entity.eid=${TARGET}`)).catch(() => {})
        }, 10)
        return Promise.resolve()
      },
      after: () => {
        clearInterval(activityTimer)
      },
      args: () => ({ limit: 64, wait: 100 }),
      verify: (text) => {
        includes(text.replaceAll('\\"', '"'), '"kind":"query"')
        includes(text, 'epoch')
      },
    },
  ]
}

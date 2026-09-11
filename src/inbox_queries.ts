// Browser inbox candidate reads. The shared inboxItem predicate still owns
// policy; these server-side screens run BEFORE the row window. A badge needs
// only unread policy columns, never letter bodies or delivery job payloads.
import type { Reader } from './client.ts'

const POLICY =
  'comment.target,notice.target,knock.target,deliver.to,mail.target,mail.to_addr,mail.message_id,opened.at,archived.at'

let valuesOf = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort()
let values = (items: (string | undefined)[]) =>
  valuesOf(items).join(',')

export let inboxQueries = (who: Reader, unreadOnly = false): string[] => {
  let watched = [...who.watching ?? []]
  let targets = [who.actor, ...watched]
  // Non-project actors receive direct mail by address, not mail.target. The
  // old broad arm fetched those rows only for inboxItem to discard them.
  let mailTargets = [who.scope, ...watched]
  let exclude = (prop: string, items: (string | undefined)[]) => {
    let got = values(items)
    return got ? `&.${prop}!=${JSON.stringify(got)}` : ''
  }
  let select = (prop: string, items: (string | undefined)[], extra = '') => {
    let got = values(items)
    return got
      ? `.${prop}=${JSON.stringify(got)}&.archived=${extra}${
        unreadOnly ? '&.opened=' : ''
      }&.fields=${POLICY}${unreadOnly ? '' : ',doc.title,created.at'}`
      : ''
  }
  return [
    select('comment.target', targets),
    select('notice.target', targets),
    select('deliver.to', [who.actor], '&.knock!'),
    select('knock.target', watched, exclude('deliver.to', [who.actor])),
    select('mail.target', mailTargets, '&.mail.message_id!'),
    select(
      'mail.to_addr',
      [...who.addrs ?? []],
      '&.mail.message_id!' + exclude('mail.target', mailTargets),
    ),
  ]
}

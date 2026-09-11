// Browser inbox candidate reads. The shared inboxItem predicate still owns
// policy; these server-side screens run BEFORE delivery. A badge needs
// only unread policy columns, never letter bodies or delivery job payloads.
import type { Reader } from './client.ts'

const POLICY =
  'comment.target,notice.target,knock.target,deliver.to,mail.target,mail.to_addr,mail.message_id,opened.at,archived.at'

let valuesOf = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort()
let values = (items: (string | undefined)[]) => valuesOf(items).join(',')

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
    select(
      'mail.target',
      watched.includes(who.scope!) ? [] : [who.scope],
      '&.mail.message_id!',
    ),
    select(
      'mail.to_addr',
      [...who.addrs ?? []],
      '&.mail.message_id!' + exclude('mail.target', mailTargets),
    ),
    // Watching overrides direct-address policy, including outbound letters.
    select('mail.target', watched),
  ]
}

// Unread badge counts for a browser reader with NO standing subscriptions.
// These arms mirror addressed()'s component precedence, not merely the union
// of candidate queries above: a row with comment + mail is a comment first.
// The caller must have an authoritative empty subscription.actor result; a
// reader with watch/mute instructions uses inboxQueries + inboxItem instead.
export let inboxCountQueries = (who: Reader): string[] => {
  let select = (prop: string, items: (string | undefined)[], extra = '') => {
    let got = values(items)
    return got
      ? `.${prop}=${JSON.stringify(got)}&.archived=&.opened=${extra}&.count!`
      : ''
  }
  let mail = '&.comment=&.notice=&.knock=&.mail.message_id!='
  return [
    select('comment.target', [who.actor]),
    select('notice.target', [who.actor], '&.comment='),
    select('deliver.to', [who.actor], '&.knock!&.comment=&.notice='),
    select('mail.target', [who.scope], mail),
    select(
      'mail.to_addr',
      [...who.addrs ?? []],
      mail + (who.scope ? `&.mail.target!=${JSON.stringify(who.scope)}` : ''),
    ),
  ]
}

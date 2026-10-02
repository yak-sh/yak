// Browser inbox candidate reads. The shared inboxItem predicate still owns
// policy; these server-side screens run BEFORE delivery. A badge needs
// only unread policy columns, never letter bodies or delivery job payloads.
import type { Vocab } from '@yaks/vocab'
import type { Reader } from './mod.ts'

const POLICY =
  'comment.target,knock.target,deliver.to,mail.target,mail.to,mail.message_id,opened.at,archived.at'

let valuesOf = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort()
let values = (items: (string | undefined)[]) => valuesOf(items).join(',')

// A missing plugin contributes no candidates or projected columns. Negative
// clauses on its absent components are already true, so they need no read.
let declared = (vocab: Vocab | undefined, path: string) => {
  let [comp, prop] = path.split('.')
  return !vocab || (prop ? !!vocab.prop(comp, prop) : !!vocab.comp(comp))
}
let clauses = (extra: string, vocab?: Vocab): string | undefined => {
  let kept: string[] = []
  for (let clause of extra.split('&').filter(Boolean)) {
    let path = clause.match(/^!?\.?([\w]+(?:\.[\w]+)?)/)?.[1]
    if (path && !declared(vocab, path)) {
      if (clause.startsWith('!') || clause.includes('!=')) continue
      return undefined
    }
    kept.push(clause)
  }
  return kept.map((c) => `&${c}`).join('')
}

export let inboxQueries = (
  who: Reader,
  unreadOnly = false,
  vocab?: Vocab,
): string[] => {
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
    let where = clauses(
      `&!archived${extra}${unreadOnly ? '&!opened' : ''}`,
      vocab,
    )
    let fields = `${POLICY}${unreadOnly ? '' : ',doc.title,created.at'}`
      .split(',').filter((path) => declared(vocab, path)).join(',')
    return got && declared(vocab, prop) && where != undefined
      ? `.${prop}=${JSON.stringify(got)}${where}&.fields=${fields}`
      : ''
  }
  return [
    select('comment.target', targets),
    select('deliver.to', [who.actor], '&.knock'),
    select('knock.target', watched, exclude('deliver.to', [who.actor])),
    select(
      'mail.target',
      watched.includes(who.scope!) ? [] : [who.scope],
      '&.mail.message_id',
    ),
    select(
      'mail.to',
      [...who.addrs ?? []],
      '&.mail.message_id' + exclude('mail.target', mailTargets),
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
export let inboxCountQueries = (who: Reader, vocab?: Vocab): string[] => {
  let select = (prop: string, items: (string | undefined)[], extra = '') => {
    let got = values(items)
    let where = clauses(`&!archived&!opened${extra}`, vocab)
    return got && declared(vocab, prop) && where != undefined
      ? `.${prop}=${JSON.stringify(got)}${where}&.count`
      : ''
  }
  let mail = '&!comment&!knock&.mail.message_id'
  return [
    select('comment.target', [who.actor]),
    select('deliver.to', [who.actor], '&.knock&!comment'),
    select('mail.target', [who.scope], mail),
    select(
      'mail.to',
      [...who.addrs ?? []],
      mail + (who.scope ? `&.mail.target!=${JSON.stringify(who.scope)}` : ''),
    ),
  ]
}

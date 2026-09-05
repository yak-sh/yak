// The package as one graph plugin: the components, the canonicalizer, and —
// when you hand it an effect registry — the sending.
//
// The canonicalizer is a `normalize` hook, which is the earliest phase there
// is: it runs before anything is admitted or written, so an address reaches
// storage in one spelling and only one. That is the difference between "we
// lowercase addresses somewhere" and "the address book cannot hold two rows
// for one person" — the rule is at the door rather than at each caller.
//
// Naming your domain is what turns it on. Without one, every address is
// somebody else's namespace and passes through untouched (see ./addr.ts).

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { canon } from './addr.ts'
import { EMAIL, MAIL, mailDoc } from './comp.ts'
import { type Post, sending } from './send.ts'

/** How the plugin is built. */
export type Mailbox = {
  /** your own mail domain — the addresses this graph canonicalizes on write */
  domain?: string
  /** register `created(mail)` on this registry, so letters actually go */
  effects?: Effects
} & Partial<Post>

// The columns that hold an address, and are therefore canonicalized on write.
let ADDRESSES: [string, string][] = [
  [EMAIL, 'address'],
  [MAIL, 'from'],
  [MAIL, 'to'],
]

let clean = (fix: (a: string) => string) => (b: Bundle): Bundle => {
  let out = b
  for (let [name, col] of ADDRESSES) {
    let comp = out[name] as Comp | null | undefined
    if (!comp || comp[col] == null) continue
    out = { ...out, [name]: { ...comp, [col]: fix(String(comp[col])) } }
  }
  return out
}

/**
 * The mail plugin: the `mail`, `email`, `deliver`, `delivered`, `bounced` and
 * `notified` components, the address canonicalizer, and the sending effect.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { effects } from '@yaks/effects'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 * import { mailbox, mailDoc, stash } from '@yaks/mail'
 *
 * let vocab = loadVocab([docDoc, mailDoc, club])
 * let fx = effects(vocab)
 * let g = graph({
 *   storage,
 *   vocab,
 *   plugins: [fx, docs(), mailbox({ domain: 'books.example', sender: stash(), effects: fx })],
 * })
 * ```
 *
 * {@link https://jsr.io/@yaks/doc | @yaks/doc} is composed BESIDE this plugin
 * rather than inside it: a letter's subject and body are `doc{title, body}`, and
 * a vocabulary refuses a component declared twice — so the word keeps one home
 * and an application that already has `doc` is not fought over it.
 *
 * Pass `effects` and a `sender` together and outbound letters go on their own;
 * pass neither and this is the vocabulary and the canonicalizer, which is all
 * a graph that only RECEIVES mail needs.
 */
export let mailbox = (
  { domain, effects, sender, now }: Mailbox = {},
): Plugin => {
  if (effects && sender) effects.created(MAIL, sending({ sender, now }))
  let fix = domain ? clean(canon(domain)) : null
  return {
    name: '@yaks/mail',
    vocab: [mailDoc],
    ...(fix ? { hooks: { normalize: (bundles) => bundles.map(fix) } } : {}),
  }
}

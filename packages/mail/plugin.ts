// The package as one graph plugin: the components, the address canonicalizer,
// and — when you pass it an effect registry — the code behind `mail_post`.
//
// The canonicalizer runs in the `normalize` phase, which is the earliest phase
// there is: before anything is validated or written, so an address reaches
// storage in one form and only one. That is the difference between "we
// lowercase addresses somewhere" and "the address book cannot hold two rows
// for one person" — the rule is applied once on the way in rather than by each
// caller.
//
// Naming your domain is what turns it on. Without one, every address belongs to
// somebody else's domain and passes through untouched (see ./addr.ts).

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import type { Effects } from '@yaks/effects'
import { canon } from './addr.ts'
import { EMAIL, MAIL, mailDoc } from './comp.ts'
import { type Post, sending } from './send.ts'

/** How the plugin is built. */
export type Mailbox = {
  /** your own mail domain — the addresses this graph canonicalizes on write */
  domain?: string
  /** handle `mail_post` on this registry, so letters actually go. The
   * registry's vocabulary carries {@link mailDoc}, which declares it, and it
   * needs a write function — `effects(vocab, { write })`, applied trusted —
   * since that is how the outcome is written back onto the letter. */
  effects?: Effects
} & Partial<Post>

// The properties that hold an address, and are therefore canonicalized on
// write.
let ADDRESSES: [string, string][] = [
  [EMAIL, 'address'],
  [MAIL, 'from'],
  [MAIL, 'to'],
]

let clean = (fix: (a: string) => string) => (b: Bundle): Bundle => {
  let out = b
  for (let [name, prop] of ADDRESSES) {
    let comp = out[name] as Comp | null | undefined
    if (!comp || comp[prop] == null) continue
    out = { ...out, [name]: { ...comp, [prop]: fix(String(comp[prop])) } }
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
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 * import { mailbox, mailDoc, stash } from '@yaks/mail'
 *
 * let vocab = loadVocab([docDoc, mailDoc])
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * let box = mailbox({ domain: 'books.example', sender: stash(), effects: fx })
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs(), box] })
 * ```
 *
 * {@link https://jsr.io/@yaks/doc | @yaks/doc} is composed beside this plugin
 * rather than inside it: a letter's subject and body are `doc{title, body}`, and
 * a vocabulary rejects a component declared twice — so `doc` keeps one home and
 * an application that already declares it is not fought over it.
 *
 * Pass `effects` and a `sender` together and outbound letters are sent
 * automatically; pass neither and this is the vocabulary and the canonicalizer,
 * which is all a graph that only receives mail needs.
 */
export let mailbox = (
  { domain, effects, sender, now, local }: Mailbox = {},
): Plugin => {
  if (effects && sender) {
    effects.handle({ mail_post: sending({ sender, now, local }) })
  }
  let fix = domain ? clean(canon(domain)) : null
  return {
    name: '@yaks/mail',
    vocab: [mailDoc],
    ...(fix ? { hooks: { normalize: (bundles) => bundles.map(fix) } } : {}),
  }
}

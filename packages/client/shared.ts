// One client per server per tab. A page is several scripts, each its own
// bundle with its own copy of this package, and each would otherwise make a
// graph of its own: the same rows held twice, a socket each, and a write one
// made that the other never sees. So the client is kept under a global key
// every copy spells the same way, made by whichever script asks first and
// grown with the words each later one brings.
import type { VocabDoc } from '@yaks/vocab'
import { loadVocab } from '@yaks/vocab'
import { type Client, client, type ClientOpts } from './client.ts'

let KEY = Symbol.for('@yaks/client/shared')

let held = (): Map<string, Client> => {
  let host = globalThis as { [KEY]?: Map<string, Client> }
  return host[KEY] ??= new Map()
}

// The words a client does not declare yet, as documents: a word already
// declared stays as it was, so the first script to declare it decides it.
let fresh = (page: Client, words: VocabDoc[]): VocabDoc[] => {
  let known = new Set(page.vocab.all)
  return words.flatMap((doc) => {
    let defs = Object.entries(doc.$defs ?? {})
      .filter(([name]) => !known.has(name))
    for (let [name] of defs) known.add(name)
    return defs.length ? [{ ...doc, $defs: Object.fromEntries(defs) }] : []
  })
}

/**
 * The tab's one client for `url`, declaring at least `words`: made the first
 * time any script on the page asks, with `opts`, and the same client every
 * time after, from any bundle, grown with words it lacked. Closing it is the
 * page's to do, never one asker's.
 *
 * ```ts
 * import { shared } from '@yaks/client'
 * import { equal } from '@yaks/testing'
 *
 * let note = { component: true, sync: 'none', properties: {} }
 * let cards = shared('https://reach.example', [{ $defs: { note } }], { vault: false, wireVault: false })
 * let talk = shared('https://reach.example', [{ $defs: { line: note } }])
 * equal(talk === cards, true)
 * equal(!!talk.vocab.comp('note') && !!talk.vocab.comp('line'), true)
 * talk.close()
 * ```
 */
export let shared = (
  url: string,
  words: VocabDoc[],
  opts: ClientOpts = {},
): Client => {
  let all = held()
  let page = all.get(url)
  if (!page) {
    let made = client(loadVocab(words), [], { ...opts, url })
    // Closed, it is no longer the page's: the next asker makes another.
    let close = made.close
    made.close = () => {
      if (all.get(url) === made) all.delete(url)
      close()
    }
    all.set(url, made)
    return made
  }
  let more = fresh(page, words)
  if (more.length && !page.extend(loadVocab([...page.vocab.docs, ...more]))) {
    throw new Error(`${url}: these words disagree with the page's`)
  }
  return page
}

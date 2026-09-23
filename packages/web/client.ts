// The browser half of @yaks/web, started by the module the server generates
// for its own config (./bundle.ts): that module imports every listed plugin's
// `./views` and the keywords of its `./vocab`, then calls {@link boot} with
// them. So a package that ships views is drawn by this door the moment a
// config names it, and nothing here names a package.
//
// The components themselves come from the server (`/web/vocab.json`), exactly
// as the host loaded them — the one copy of the vocabulary there is. What the
// browser adds is only what interprets it: the keywords, which are code.

import { client } from '@yaks/client'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { define, type Registry } from '@yaks/render'
import { type Keywords, loadVocab, type VocabDoc } from '@yaks/vocab'
import { h, render } from 'preact'
import { Shell } from './app.ts'
import { views as generic } from './views.ts'

/** What the generated module hands over: each listed plugin's views, in config
 * order, and the keywords its vocabulary is written with. */
export type Boot = { name: string; views: Registry[]; keywords: Keywords[] }

// The keywords every host understands whether or not a plugin brings them
// (@yaks/cli `understood`), and each set once.
let understood = (brought: Keywords[]): Keywords[] => {
  let seen = new Set<string>()
  return [...brought, idKeywords, nameKeywords].filter((k) =>
    !seen.has(k.uri) && !!seen.add(k.uri)
  )
}

/** Load the vocabulary, open the client on this origin, and draw the app into
 * the page. */
export let boot = async ({ name, views, keywords }: Boot): Promise<void> => {
  let docs: VocabDoc[] = await (await fetch('/web/vocab.json')).json()
  let vocab = loadVocab(docs, understood(keywords))
  let box = client(vocab, [], {
    url: location.origin,
    vault: false,
    wireVault: false,
    report: (trouble) => console.warn('yak', trouble),
  })
  // A package's own views first: equal scores go to the earlier registration,
  // and these are the ones that know their components.
  let registry = define([
    ...views.flatMap((r) => r.renderers),
    ...generic.renderers,
  ])
  render(h(Shell, { app: { box, vocab, registry, name } }), document.body)
}

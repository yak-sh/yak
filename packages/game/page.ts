import { type Client, client, type ClientOpts } from '@yaks/client'
import { loadVocab, narrow, type VocabDoc } from '@yaks/vocab'
import { docs } from './vocab.ts'

/** The app's API address, additional page vocabulary and client transports. */
export type PageOptions = Omit<ClientOpts, 'vault' | 'wireVault'> & {
  api?: string | URL
  words?: VocabDoc[]
}

/** Open the app's vocabulary in a RAM graph with the game controls and the
 * app's page vocabulary. A component with sync: none stays on this page. */
export let page = async (
  { api = new URL('./api/', document.baseURI), words = [], ...options }:
    PageOptions = {},
): Promise<Client> => {
  let base = new URL(api)
  base.pathname = base.pathname.replace(/\/?$/, '/')
  let get = options.fetch ?? fetch
  let response = await get(new Request(new URL('vocab.json', base)))
  if (!response.ok) throw new Error(`Game vocabulary: HTTP ${response.status}`)
  let stored = await response.json() as VocabDoc[]
  let local = [...docs, ...words].map((doc) =>
    narrow(doc, (name) => !stored.some((remote) => remote.$defs?.[name]))
  )
  let front = client(loadVocab([...stored, ...local]), [], {
    url: new URL(base.pathname.slice(0, -1), base).href,
    ...options,
    vault: false,
    wireVault: false,
  })
  await front.ready
  return front
}

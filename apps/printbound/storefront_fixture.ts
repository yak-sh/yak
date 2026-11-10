import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { store } from './store.ts'

export let memory = (manifest: VocabDoc) => {
  let vocab = loadVocab([manifest, {
    $defs: {
      doc: {
        properties: { title: { type: 'string' }, body: { type: 'string' } },
      },
      session: { properties: { status: { type: 'string' } } },
      entry: {
        properties: { session: { type: 'string' }, seq: { type: 'number' } },
      },
      content: { properties: { body: { type: 'string' } } },
      attachment: {
        properties: {
          artifact: { type: 'string' },
          audience: { type: 'string' },
        },
      },
      output: { properties: { source: { type: 'string' } } },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  g.install()
  let binding = {
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      let url = new URL(path, 'https://store.invalid')
      if (url.pathname === '/query') {
        return Response.json(await g.read(url.searchParams.get('q') ?? ''))
      }
      let body = JSON.parse(String(init!.body)) as { entities: Bundle[] }
      return Response.json({ bundles: await g.apply(body.entities) })
    },
  }
  return { g, binding, db: store(binding) }
}

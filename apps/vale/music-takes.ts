// A small editor over retained music outputs. Hosted subscriptions and page
// state share the client graph; choosing goes through the editor-only door.
import { h, render } from 'preact'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { dressVale } from './ui-style.ts'
import { type Row, songs, TAKES } from './music_takes.ts'
import { Takes } from './music-takes-view.ts'

let base = new URL('./', location.href)
let [doc, me] = await Promise.all([
  fetch(new URL('api/vocab.json', base)).then((r) => r.json()),
  fetch(new URL('api/me', base)).then((r) => r.json()),
])
let local = {
  $defs: {
    MusicTakes: {
      component: true,
      type: 'object',
      sync: 'none',
      properties: {
        editor: { type: 'boolean' },
        busy: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
}
let box = client(loadVocab([doc, local]), [], {
  url: new URL('api/', base).href,
})
let id = crypto.randomUUID()
await box.ready
await dressVale()
let state = (patch: object) =>
  box.graph.apply([
    { entity: { eid: id }, MusicTakes: patch },
  ])
state({
  editor: ['owner', 'editor'].includes(me.role),
  busy: null,
  message: '',
})
let rows = box.watch(TAKES, { evaluate: 'server' })
let ui = box.watch(`.entity.eid=${id}&.MusicTakes`, { remote: false })
let choose = async (output: string) => {
  state({ busy: output, message: '' })
  try {
    let r = await fetch(new URL('api/choose', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output }),
    })
    let said = await r.json()
    if (!r.ok) {
      throw new Error(said.message ?? said.error ?? `Choose: ${r.status}`)
    }
    state({ message: 'Recording chosen. The next play uses this take.' })
  } catch (error) {
    state({ message: error instanceof Error ? error.message : String(error) })
  } finally {
    state({ busy: null })
  }
}
let paint = () => {
  let s = box.ent(id)?.MusicTakes as {
    editor: boolean
    busy: string | null
    message: string
  }
  render(
    h(Takes, { ...s, songs: songs(rows.value as Row[]), choose }),
    document.getElementById('takes')!,
  )
}
rows.subscribe(paint)
ui.subscribe(paint)
paint()

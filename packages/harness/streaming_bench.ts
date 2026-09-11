/** Isolated synthetic comparison; not a live provider benchmark.
 * deno run -A packages/harness/streaming_bench.ts */
import { graph, transient } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { subscriptions } from '@yaks/api'
const vocab = loadVocab([{
  $defs: { doc: { properties: { body: { type: 'string' } } } },
}])
for (const live of [false, true]) {
  const g = graph({ vocab, storage: ram(vocab) })
  await g.apply([{ entity: { eid: 'd' }, doc: { body: '' } }])
  let writes = 0, bytes = 0, frames = 0
  g.use({
    name: 'counter',
    hooks: {
      effect: (b) => {
        writes++
        return b
      },
    },
  })
  const subs = subscriptions(g)
  await subs.open(
    (frame) => {
      bytes += JSON.stringify(frame).length
      frames++
    },
    'd',
    '.doc',
  )
  const start = performance.now(), count = 2000, text = 'abcdefghij'
  if (live) {
    const writer = await transient(g).begin('d', 'doc', 'body', 'stream')
    for (let i = 0; i < count; i++) writer.append(text)
    await writer.commit()
  } else {
    for (let i = 0; i < count; i++) {
      await g.apply([{
        entity: { eid: 'd' },
        doc: { body: text.repeat(i + 1) },
      }])
    }
  }
  await Promise.resolve()
  console.log(
    JSON.stringify({
      live,
      deltas: count,
      characters: count * text.length,
      writes,
      frames,
      serializedCharacters: bytes,
      ms: Math.round(performance.now() - start),
    }),
  )
}

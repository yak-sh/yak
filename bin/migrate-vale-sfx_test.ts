// A completed sound carries its bytes and citation to the shared builder;
// a sound with no output remains due for a call.
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { migrate } from './migrate-vale-sfx.ts'

let row = (eid: string, fields: Record<string, unknown>): Bundle =>
  ({ entity: { eid }, ...fields }) as Bundle
let comp = (r: Bundle | undefined, name: string): Comp | undefined =>
  r?.[name] as Comp | undefined

Deno.test('sound migration keeps completed audio and retries missing output', () => {
  let definition = row('shared', {
    builder: { query: '$sfx .sfx', to: 'tool', immediate: true },
    content: { body: 'Generate sound\n\n$description' },
    using: { model: 'seed' },
  })
  let before = {
    builders: [
      row('old-water', {
        builder: { query: '.sfx.name=water', model: 'seed' },
        doc: { body: 'Generate sound' },
      }),
      row('old-rain', {
        builder: { query: '.sfx.name=rain', model: 'seed' },
        doc: { body: 'Generate sound' },
      }),
    ],
    builds: [
      row('run-water', {
        build: {
          builder: 'old-water',
          inputs: ['water'],
          variant: 'main',
          key: 'old-key',
          session: 'session-water',
        },
      }),
      row('run-rain', {
        build: {
          builder: 'old-rain',
          inputs: ['rain'],
          variant: 'main',
          key: 'old-key',
          session: 'session-rain',
        },
      }),
    ],
    outputs: [row('old-output', {
      doc: { title: 'water', body: 'Original request' },
      built: {
        builder: 'old-water',
        variant: 'main',
        slot: 'main',
        key: 'old-key',
        artifact: 'audio',
      },
    })],
    sounds: [
      row('water', { doc: { body: 'Water sound' }, sfx: { name: 'water' } }),
      row('rain', { doc: { body: 'Rain sound' }, sfx: { name: 'rain' } }),
    ],
    artifacts: [row('audio', {
      artifact: {
        address: 'audio',
        media_type: 'audio/mpeg',
        size: 10,
      },
    })],
    citations: [row('old-cite', {
      edge: { from: 'old-output', to: 'water' },
      cites: { hash: 'water-hash' },
    })],
  }
  let plans = ['water', 'rain'].map((name) => ({
    build: `new-${name}`,
    match: JSON.stringify([name]),
    variant: 'main',
    binding: { entities: [name], vars: { description: `${name} sound` } },
    key: `key-${name}`,
    to: 'tool',
    template: 'Generate sound\n\n$description',
    using: { model: 'seed' },
  }))
  let change = migrate(before, definition, plans)
  let built = change.find((r) => r.built)!
  let audio = change.find((r) => r.artifact)
  assertEquals(audio, undefined)
  assertEquals(comp(built, 'built'), {
    build: 'new-water',
    slot: 'main',
    key: 'key-water',
    call: comp(built, 'built')?.call,
    artifact: 'audio',
  })
  assertEquals(built.doc, before.outputs[0].doc)
  assertEquals(comp(change.find((r) => r.cites), 'edge')?.to, 'water')
  assertEquals(comp(change.find((r) => r.cites), 'cites')?.hash, 'water-hash')
  assertEquals(
    comp(change.find((r) => comp(r, 'build')?.match == '["rain"]'), 'build')
      ?.key,
    null,
  )
  assertEquals(change.filter((r) => r.$delete).length, 5)
})

// A legacy app's schema edit inherits its own files, without rewriting pages.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { platform } from './testing.ts'
import { ADA, seeded } from './serving-probe.ts'
import { call, type Ctx } from './tools.ts'
import { r2Objects } from './lib/objects.ts'
import { draftFiles, manifest, sha256 } from './versions.ts'

test(
  'a source-less app keeps every original byte through a schema draft',
  async () => {
    using p = platform('draft-test-secret')
    let { dir, app } = await seeded(p.env)
    let ctx: Ctx = { env: p.env, dir, person: ADA }
    let tool = (op: string, more: Record<string, unknown> = {}) =>
      call(ctx, 'app_files', {
        space: 'ada',
        app: 'cookbook',
        op,
        ...more,
      })
    let blobs = r2Objects(p.env.BLOBS)
    let prefix = 'ada/cookbook/'
    let originals = new Map([
      ['index.html', new TextEncoder().encode('<h1>Original page</h1>')],
      ['vocab.json', new TextEncoder().encode('{"$defs":{}}')],
      ...Array.from({ length: 229 }, (_, i): [string, Uint8Array] => [
        `assets/${i}.bin`,
        new Uint8Array([0, 255, i % 256, 128]),
      ]),
    ])
    for (let [path, bytes] of originals) await blobs.put(prefix + path, bytes)
    let files = await manifest(blobs, prefix)
    // A legacy deploy has a manifest but no source release pointer.
    await dir.stamp({
      entities: [{
        entity: { eid: '$deploy' },
        deploy: {
          app: app.eid,
          version: 1,
          files: JSON.stringify(files),
          worker: '',
        },
      }],
    }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
    let schema = '{"$defs":{"note":{"component":true,"type":"object"}}}'
    await tool('write', { files: [{ path: 'vocab.json', content: schema }] })
    let expected: Record<string, string> = {
      ...files,
      'vocab.json': await sha256(
        new TextEncoder().encode(schema),
      ),
    }
    assertEquals((await tool('list')).value, {
      files: Object.keys(expected).sort().map((path) => ({
        path,
        sha: expected[path],
      })),
      unreleased: true,
    })
    let editing = (await dir.app((await dir.space('ada'))!, 'cookbook'))!
    let view = draftFiles(blobs, editing.draft, 'ada/cookbook')
    for (let [path, bytes] of originals) {
      assertEquals(await blobs.get(prefix + path), bytes)
      if (path != 'vocab.json') {
        assertEquals(await view.get(`${editing.draft}/${path}`), bytes)
      }
    }
    assertEquals((await tool('read', { path: 'vocab.json' })).text, schema)
  },
)

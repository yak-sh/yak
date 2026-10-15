// An app still served in place from its own prefix, its draft perhaps still
// kept as bytes of its own, comes into the shape a write keeps files in the
// first time anything touches it, and loses none of them on the way.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { platform } from './testing.ts'
import { ADA, seeded } from './serving-probe.ts'
import { call, type Ctx } from './tools.ts'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { type Files, sha256 } from './versions.ts'

let encode = (text: string) => new TextEncoder().encode(text)

for (let open of [false, true]) {
  test(
    open
      ? 'an app served in place keeps its open draft and every file'
      : 'an app served in place keeps every file through its first edit',
    async () => {
      await using p = platform('draft-test-secret')
      let { dir, app } = await seeded(p.env)
      let ctx: Ctx = { env: p.env, dir, person: ADA }
      let tool = (op: string, more: Record<string, unknown> = {}) =>
        call(ctx, 'app_files', { space: 'ada', app: 'cookbook', op, ...more })
      let blobs = r2RawObjects(p.env.BLOBS)
      let prefix = 'ada/cookbook/'
      let originals = new Map([
        ['index.html', encode('<h1>Original page</h1>')],
        ['vocab.json', encode('{"$defs":{}}')],
        ['gone.css', encode('body{}')],
        ...Array.from({ length: 29 }, (_, i): [string, Uint8Array] => [
          `assets/${i}.bin`,
          new Uint8Array([0, 255, i % 256, 128]),
        ]),
      ])
      for (let [path, bytes] of originals) await blobs.put(prefix + path, bytes)
      // What the platform kept beside an app's files is not one of them.
      for (let path of ['blobs/audio.mp3', 'versions/v1.json']) {
        await blobs.put(prefix + path, new Uint8Array([42]))
      }
      let files: Files = {}
      for (let [path, bytes] of originals) {
        files[path] = await sha256(new Uint8Array(bytes))
      }
      // A deploy made in place has a manifest and no release.
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
      let expected: Files = { ...files }
      if (open) {
        // A draft kept as its own bytes: a page edited, a file deleted.
        let draft = `ada/.drafts/${app.eid}/delta-v2-x`
        await blobs.put(`${draft}/index.html`, encode('<h1>Edited</h1>'))
        await blobs.put(`${draft}/.deleted/gone.css`, new Uint8Array())
        await dir.stamp({
          entities: [{ entity: { eid: app.eid }, app: { draft } }],
        }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
        expected['index.html'] = await sha256(encode('<h1>Edited</h1>'))
        delete expected['gone.css']
      }
      let schema = '{"$defs":{"note":{"component":true,"type":"object"}}}'
      await tool('write', { files: [{ path: 'vocab.json', content: schema }] })
      expected['vocab.json'] = await sha256(encode(schema))
      let listed = (want: Files, unreleased: boolean, version: number) => ({
        files: Object.keys(want).sort().map((path) => ({
          path,
          sha: want[path],
        })),
        unreleased,
        version,
      })
      assertEquals((await tool('list')).value, listed(expected, true, 1))
      // The old draft's own keys are gone once its rows hold it.
      assertEquals(await blobs.list(`ada/.drafts/${app.eid}/`), [])
      assertEquals((await tool('read', { path: 'vocab.json' })).text, schema)
      await call(ctx, 'app_deploy', { space: 'ada', app: 'cookbook' })
      assertEquals((await tool('list')).value, listed(expected, false, 2))
      let released = (await dir.app((await dir.space('ada'))!, 'cookbook'))!
      let served = r2Objects(p.env.BLOBS)
      for (let [path, bytes] of originals) {
        if (!(path in expected) || path == 'vocab.json') continue
        if (open && path == 'index.html') continue
        assertEquals(await served.get(`${released.source}/${path}`), bytes)
      }
      assertEquals(
        (await served.list(`${released.source}/`))
          .filter((key) => /\/(blobs|versions)\//.test(key)),
        [],
      )
    },
  )
}

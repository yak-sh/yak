import { cleanup, equal, test, throws } from '@yaks/testing'
import { materialized } from './asset-ready.ts'

let fixture = (variable = false) => {
  let root = Deno.makeTempDirSync({ prefix: 'yak-assets-' })
  let source = `${root}/input.bin`, output = `${root}/output.bin`
  Deno.writeFileSync(source, new Uint8Array([255]))
  let calls = 0, fail = false
  let make = async () => {
    calls++
    if (fail) throw Error('generation failed')
    await Deno.writeFile(
      output,
      variable ? new Uint8Array([calls]) : await Deno.readFile(source),
    )
  }
  return {
    source,
    output,
    run: () =>
      materialized(
        [source],
        () => Promise.resolve([output]),
        make,
        `${root}/memo`,
      ),
    calls: () => calls,
    fail: (value: boolean) => fail = value,
    close: () => Deno.removeSync(root, { recursive: true }),
  }
}
let reused = fixture(),
  changed = fixture(),
  lost = fixture(),
  failed = fixture(),
  edited = fixture()

test('unchanged asset inputs and outputs reuse the completed generation', async () => {
  cleanup(reused.close)
  await reused.run()
  await reused.run()
  equal(reused.calls(), 1)
})

test('asset generation follows binary source changes without losing byte differences', async () => {
  cleanup(changed.close)
  await changed.run()
  await Deno.writeFile(changed.source, new Uint8Array([254]))
  await changed.run()
  equal(changed.calls(), 2)
  equal([...await Deno.readFile(changed.output)], [254])
})

test('a missing required asset is regenerated from its current inputs', async () => {
  cleanup(lost.close)
  await lost.run()
  await Deno.remove(lost.output)
  await lost.run()
  await lost.run()
  equal(lost.calls(), 2)
  equal([...await Deno.readFile(lost.output)], [255])
})

test('editing an output regenerates the asset before it can be served', async () => {
  cleanup(edited.close)
  await edited.run()
  await Deno.writeFile(edited.output, new Uint8Array([0]))
  await edited.run()
  equal(edited.calls(), 2)
  equal([...await Deno.readFile(edited.output)], [255])
})

test('failed asset generation is retried instead of being remembered as ready', async () => {
  cleanup(failed.close)
  failed.fail(true)
  await throws(failed.run, 'generation failed')
  failed.fail(false)
  await failed.run()
  await failed.run()
  equal(failed.calls(), 2)
})

let refreshed = fixture(true)
test('regeneration remembers the new output bytes even when identical inputs produce different bytes', async () => {
  cleanup(refreshed.close)
  await refreshed.run()
  await Deno.remove(refreshed.output)
  await refreshed.run()
  await refreshed.run()
  equal(refreshed.calls(), 2)
  equal([...await Deno.readFile(refreshed.output)], [2])
})

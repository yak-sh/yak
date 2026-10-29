// Timed apply boundary only: seed, warmup, verification and disposal excluded.
import {
  APPLY_MODES,
  APPLY_SHAPES,
  APPLY_SIZES,
  APPLY_WORK,
  RECORDING_BATCHES,
} from './names.ts'
import {
  applyBundles,
  applyFixture,
  runApplies,
  verifyApplies,
} from './apply-fixture.ts'
import { applyRecording } from './apply-recording.ts'

let recording = Deno.env.get('BENCH_RECORDING') ?? '0'
let grouped = recording != '0'
let active = recording == 'subscribed'
for (let mode of APPLY_MODES) {
  for (let work of APPLY_WORK) {
    for (let n of APPLY_SIZES) {
      for (let shape of APPLY_SHAPES) {
        Deno.bench({
          name: `apply/${mode}/${work}-${shape}-${n}${
            active ? '/subscribed' : ''
          }`,
          n: grouped ? 2 : 10,
          warmup: grouped ? 1 : 5,
          fn: async (b) => {
            let fixtures: Awaited<ReturnType<typeof applyFixture>>[] = []
            let recorder: ReturnType<typeof applyRecording> | undefined
            try {
              for (let i = 0; i < (grouped ? RECORDING_BATCHES : 1); i++) {
                fixtures.push(await applyFixture(mode))
              }
              recorder = active
                ? applyRecording(fixtures.map((f) => f.g))
                : undefined
              let bundles = applyBundles(work, n)
              b.start()
              for (let f of fixtures) runApplies(f, bundles, shape)
              recorder?.finish()
              b.end()
              recorder?.stop()
              for (let f of fixtures) verifyApplies(f, bundles)
            } finally {
              recorder?.stop()
              for (let f of fixtures) f.close()
            }
          },
        })
      }
    }
  }
}

import { equal, test } from '@yaks/testing'
import { captions, frameList, waiting } from './studio.ts'

test('each frame shows until the next, the last until the recording ends', () => {
  equal(
    frameList(['d/rec-000412.jpg', 'd/rec-000000.jpg'], 2000, 'd/end.png'),
    [
      "file 'd/rec-000000.jpg'",
      'duration 0.412',
      "file 'd/rec-000412.jpg'",
      'duration 1.588',
      "file 'd/rec-000412.jpg'",
      '',
    ].join('\n'),
  )
  equal(
    frameList([], 3000, 'd/end.png'),
    "file 'd/end.png'\nduration 3.000\nfile 'd/end.png'\n",
  )
})

test('captions say each line while it is said, laid out in the video’s pixels', () => {
  let ass = captions([{ at: 300, ms: 61500, text: 'Ask for an app.' }])
  equal(ass.split('\n').filter((l) => /^(PlayRes|Dialogue)/.test(l)), [
    'PlayResX: 1280',
    'PlayResY: 720',
    'Dialogue: 0,0:00:00.30,0:01:01.80,Line,Ask for an app.',
  ])
})

test('a take whose panel has a newer take is stale, not filmed', () => {
  let take = (
    eid: string,
    panel: string,
    n: number,
    at: string,
    film?: string,
  ) => ({
    entity: { eid },
    take: { panel, n, ...film ? { film } : {} },
    created: { at },
  })
  let { film, stale } = waiting([
    take('b', 'p2', 2, '2026-11-27T10:00:00Z'),
    take('old', 'p1', 1, '2026-11-27T09:00:00Z'),
    take('new', 'p1', 1, '2026-11-27T11:00:00Z'),
    take('done', 'p3', 3, '2026-11-27T08:00:00Z', 'f'),
  ])
  equal(film.map((t) => t.entity.eid), ['new', 'b'])
  equal(stale.map((t) => t.entity.eid), ['old'])
})

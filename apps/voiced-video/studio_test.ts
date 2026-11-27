import { equal, test } from '@yaks/testing'
import { frameList, srt } from './studio.ts'

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

test('captions say each line while it is said', () => {
  equal(
    srt([{ at: 300, ms: 1500, text: 'Ask for an app.' }]),
    '1\n00:00:00,300 --> 00:00:01,800\nAsk for an app.\n',
  )
})

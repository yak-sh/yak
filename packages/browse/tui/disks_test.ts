import './doc.ts'
import '../testing.ts'
import { equal, ok, test, until } from '@yaks/testing'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { TElement } from '@yaks/tui'
import { docs } from '@yaks/file/vocab'
import { DisksPage } from '../../file/page.ts'
import { occupancyOf } from '@yaks/file/occupancy'
import { learn, vocab } from '../types.ts'
import { cache, config } from '../live.ts'
import { host, reader } from '../host_testing.ts'
import { inspectIo } from '../components/inspect.tsx'
import { pane } from './testing.ts'

let volume = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let eid = occupancyOf(volume, '2026-10-27')
let disk = {
  entity: { eid: volume },
  volume: { machine: 'machine', mount: '/' },
}
let look = {
  entity: { eid },
  occupancy: {
    volume,
    day: '2026-10-27',
    at: '2026-10-27T12:00:00Z',
    size: 1000,
    used: 700,
    free: 300,
    counted: 650,
    paths: { 'home/': 600, 'home/notes.txt': 600 },
  },
}

let pending = ''
let painted = ''
{
  let priorDocs = vocab.docs
  let priorHost = config.host
  learn([...priorDocs, ...docs])
  config.host = 'disks.test'
  cache.value = {}
  let read = reader([look])
  let wire = host(({ subscribe }) => {
    if (subscribe.includes('.fields=occupancy.')) {
      let bundles = read(subscribe)
      return {
        bundles,
        coverage: {
          [eid]: {
            occupancy: ['day', 'at', 'size', 'used', 'free', 'counted'],
          },
        },
      }
    }
    return undefined
  })
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  try {
    await act(() =>
      render(
        h(DisksPage, {
          e: { entity: { eid: 'disks' } },
          ctx: {},
          io: inspectIo,
          got: { volumes: { rows: [disk], ready: true } },
        }),
        target,
      )
    )
    await until(() => wire.asked().some((a) => a.subscribe.includes(eid)), {
      label: 'full look asked',
    })
    pending = root.textContent
    let ask = wire.asked().find((a) => a.subscribe.includes(eid))!
    await act(() => wire.say({ id: ask.id, bundles: [look] }))
    await until(() => root.textContent.includes('notes.txt'), {
      label: 'directory tree',
    })
    let trend = wire.asked().find((a) =>
      a.subscribe.includes('.fields=occupancy.')
    )!
    await act(() =>
      wire.say({
        id: trend.id,
        bundles: read(trend.subscribe),
        coverage: {
          [eid]: {
            occupancy: ['day', 'at', 'size', 'used', 'free', 'counted'],
          },
        },
      })
    )
    painted = pane(root).lines.map((line) =>
      line.map((span) => span.text).join('')
    ).join('\n')
  } finally {
    render(null, target)
    wire.free()
    cache.value = {}
    config.host = priorHost
    learn(priorDocs)
  }
}

test('Disks waits for its full look after receiving only the trend figures', () => {
  ok(pending.includes('Loading what fills it'))
  equal(pending.includes('notes.txt'), false)
})

test('Disks paints its directory tree in the terminal once the full look arrives', () => {
  ok(painted.includes('What fills it'))
  ok(painted.includes('notes.txt'))
})

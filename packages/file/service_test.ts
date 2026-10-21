// The duty looks at each disk into its day's row: the volume once, the
// filesystem's figures as the walk ends, nothing more within the hour, and
// nothing at all from a walk stopped as the process winds down. One computer,
// a disk of its own for each case.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docs as machineDocs } from '@yaks/machine/vocab'
import { fileDoc } from './vocab.ts'
import { volumeOf } from './mod.ts'
import { here } from './local.ts'
import { type Disk, occupancyOf, type Walk } from './occupancy.ts'
import { type Looking, pass } from './service.ts'

let vocab = loadVocab([...machineDocs, fileDoc])
let g = graph({ vocab, storage: ram(vocab) })
let machine = await here(g)
let NOW = Date.now()
let DAY = new Date(NOW).toISOString().slice(0, 10)
let walk: Walk = { counted: 500, paths: { 'home/': 400, 'home/a.db': 300 } }

// A computer whose disk reads `figures` in turn, and whose walks are counted.
let computer = (figures: Disk[], walked?: Walk) => {
  let n = { walks: 0 }
  let look: Looking = {
    disks: () =>
      Promise.resolve([figures.length > 1 ? figures.shift()! : figures[0]]),
    walk: () => (n.walks++, Promise.resolve(walked)),
  }
  return { look, n }
}
let disk = (mount: string, used = 600): Disk => ({
  mount,
  size: 1000,
  used,
  free: 900 - used,
})
let day = async (mount: string) => {
  let volume = volumeOf(machine, mount)
  let [row] = await g.get([occupancyOf(volume, DAY)], ['occupancy'])
  return { volume, row: row?.occupancy as Record<string, unknown> | undefined }
}

test('a walk stopped as the process winds down keeps nothing', async () => {
  let { look } = computer([disk('/mnt')])
  await pass(g, look, NOW)
  equal((await day('/mnt')).row, undefined)
})

test('a day looked at within the hour is not walked again', async () => {
  let { look, n } = computer([disk('/srv')])
  let volume = volumeOf(machine, '/srv')
  let at = new Date(NOW - 60_000).toISOString()
  let occupancy = { volume, day: DAY, at, size: 1, used: 1, free: 0, ...walk }
  await g.apply([{ entity: { eid: occupancyOf(volume, DAY) }, occupancy }], {
    trusted: true,
  })
  await pass(g, look, NOW)
  equal(n.walks, 0)
})

test('a look keeps the day, with the figures as its walk ends', async () => {
  let { look } = computer([disk('/'), disk('/', 610)], walk)
  await pass(g, look, NOW)
  let { volume, row } = await day('/')
  equal({ ...row, at: '' }, {
    volume,
    day: DAY,
    at: '',
    size: 1000,
    used: 610,
    free: 290,
    ...walk,
  })
})

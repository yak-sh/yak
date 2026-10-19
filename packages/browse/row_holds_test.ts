// Row demand batches without borrowing ownership or losing a surviving view.
import { equal, test } from '@yaks/testing'
import { rowHolds } from './row_holds.ts'

let fixture = () => {
  let jobs: (() => void)[] = []
  let lines = new Map<string, string>()
  let networks = new Map<string, Set<string>>()
  let events: string[] = []
  let hold = rowHolds((name, line) => {
    lines.set(name, line)
    let owners = networks.get(line)
    if (!owners) {
      networks.set(line, owners = new Set())
      events.push('open ' + line)
    }
    owners.add(name)
  }, (name) => {
    let line = lines.get(name)!
    lines.delete(name)
    let owners = networks.get(line)!
    owners.delete(name)
    if (!owners.size) {
      networks.delete(line)
      events.push('close ' + line)
    }
  }, (run) => jobs.push(run))
  return {
    hold,
    lines,
    networks,
    events,
    flush: () => {
      for (let run of jobs.splice(0)) run()
    },
  }
}

let wave = fixture()
let waveOff = Array.from({ length: 20 }, (_, i) => wave.hold(['r' + i]))
let expected = 'id=' + Array.from({ length: 20 }, (_, i) => 'r' + i).join(',')
test('twenty simultaneous readers share one request and retain separate lives', () => {
  equal(wave.networks.size, 0)
  wave.flush()
  equal(wave.events, ['open ' + expected])
  equal(wave.lines.size, 1)
  for (let off of waveOff.slice(0, 19)) off()
  equal(wave.networks.size, 1)
  equal(wave.lines.size, 1)
  waveOff[19]()
  equal(wave.networks.size, 0)
  equal(wave.events, ['open ' + expected, 'close ' + expected])
})

let repeated = fixture()
let first = repeated.hold(['a']), second = repeated.hold(['a'])
test('a repeated hold survives one release and canceled demand never opens', () => {
  repeated.hold(['canceled'])()
  repeated.flush()
  equal([...repeated.lines.values()], ['id=a'])
  first()
  first()
  equal(repeated.networks.size, 1)
  second()
  equal(repeated.networks.size, 0)
})

let bounded = fixture()
let boundOff = Array.from({ length: 61 }, (_, i) => bounded.hold(['r' + i]))
test('independent request groups retain at most sixty row identities', () => {
  bounded.flush()
  equal(bounded.networks.size, 2)
  equal([...bounded.networks.keys()].map((q) => q.slice(3).split(',').length), [
    60,
    1,
  ])
  for (let off of boundOff) off()
  equal(bounded.networks.size, 0)
})

let newWave = fixture()
let oldView = newWave.hold(['old'])
newWave.flush()
let newView = newWave.hold(['new'])
test('later rows open independently without replacing an existing answer', () => {
  newWave.flush()
  equal([...newWave.networks.keys()], ['id=old', 'id=new'])
  oldView()
  equal([...newWave.networks.keys()], ['id=new'])
  newView()
  equal(newWave.networks.size, 0)
})

let reunion = fixture()
let oneOff = reunion.hold(['a'])
let twoOff = reunion.hold(['b'])
reunion.flush()
oneOff()
let wholeOff = reunion.hold(['a', 'b'])
test('a later full holder joins the existing immutable group without closing it', () => {
  reunion.flush()
  equal(reunion.events, ['open id=a,b'])
  twoOff()
  equal(reunion.networks.size, 1)
  wholeOff()
  equal(reunion.events, ['open id=a,b', 'close id=a,b'])
})

let canceled = fixture()
let cancelOff = canceled.hold(['gone'])
cancelOff()
test('a wave canceled before its turn opens no request', () => {
  canceled.flush()
  equal(canceled.events, [])
})

let large = fixture()
let largeIds = Array.from({ length: 61 }, (_, i) => 'large-' + i)
let largeOff = large.hold(largeIds)
test('an explicitly large row list remains one immediate request', () => {
  equal([...large.networks.keys()], ['id=' + largeIds.join(',')])
  largeOff()
  equal(large.networks.size, 0)
})

let resetJobs: (() => void)[] = [], resetEvents: string[] = []
let resetting = rowHolds(
  (_name, query) => resetEvents.push('open ' + query),
  (name) => resetEvents.push('close ' + name),
  (run) => resetJobs.push(run),
)
let oldReset = resetting(['same'])
resetting.clear()
let currentReset = resetting(['same'])
oldReset()
test('a reset cancels old demand without releasing a new holder of the same row', () => {
  resetJobs.shift()!()
  equal(resetEvents, [])
  resetJobs.shift()!()
  equal(resetEvents, ['open id=same'])
  oldReset()
  equal(resetEvents, ['open id=same'])
  currentReset()
  equal(resetEvents, ['open id=same', 'close rows:same'])
})

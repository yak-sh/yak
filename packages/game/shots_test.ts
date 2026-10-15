import { equal, test, throws } from '@yaks/testing'
import { arrivals, shotFlight } from './shots.ts'

test('flight keeps horizontal hit timing and deterministic volley scatter', () => {
  let from: [number, number, number] = [0, 10, 0]
  let to: [number, number, number] = [3, 20, 4]
  let random = [0.7, 0.25, 0]
  let flight = shotFlight(from, to, 10, 2, 4, () => random.shift()!)
  equal(flight.ms, 500)
  equal(flight.shots, [
    { from, to, ms: 500 },
    { from, to: [5, 20, 4], ms: 535 },
  ])
  equal(random, [])
  equal(shotFlight(from, to, 10, 0).shots, [])
  equal(shotFlight(from, from, 10).ms, 0)
  equal(from, [0, 10, 0])
  equal(to, [3, 20, 4])
  throws(() => shotFlight(from, to, 0))
})

test('arrivals consume hits exactly once at the deadline, retaining payloads and order', () => {
  let shots = [
    { lands: 200, target: 'later', dmg: 5 },
    { lands: 100, target: 'gone', dmg: 7 },
    { lands: 150, target: 'down', dmg: 0 },
    { lands: 150, target: 'live', dmg: 4 },
  ]
  let { due, pending } = arrivals(shots, 150)
  equal(due, shots.slice(1))
  equal(pending, shots.slice(0, 1))
  equal(due[0] === shots[1], true)
  equal(arrivals(pending, 150).due, [])
  equal(arrivals(pending, 200), { due: pending, pending: [] })
  equal(shots.length, 4)
})

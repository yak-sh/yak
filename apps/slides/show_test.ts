import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  fit,
  keep,
  layoutOf,
  lookOf,
  move,
  nextOrd,
  ordered,
  paceOf,
  split,
  step,
  summary,
} from './show.js'

let slide = (eid: string, ord: number, extra = {}, show = 's') => ({
  entity: { eid },
  slide: { show, ord, ...extra },
  doc: { title: eid },
})
type Row = { entity: { eid: string } }
let ids = (rows: Row[]) => rows.map((r) => r.entity.eid)
let show = (seconds?: number, look?: string) => ({
  entity: { eid: 's' },
  show: { seconds, look },
})

test('slides keep their own show and their playing order', () => {
  let slides = [slide('b', 2), slide('x', 1, {}, 'other'), slide('a', 1)]
  assertEquals(ids(ordered(slides, 's')), ['a', 'b'])
  assertEquals(nextOrd(ordered(slides, 's')), 3)
  assertEquals(nextOrd([]), 1)
  let { shows, slides: all } = split([
    { entity: { eid: 'z' }, show: {}, doc: { title: 'Zinnias' } },
    { entity: { eid: 'w' }, show: {}, doc: { title: 'Wren' } },
    slide('a', 1),
  ])
  assertEquals([ids(shows), ids(all)], [['w', 'z'], ['a']])
})

test('moving a slide swaps it with its neighbour and stops at the ends', () => {
  let slides = [slide('a', 1), slide('b', 2), slide('c', 3)]
  assertEquals(move(slides, 'b', -1), [
    { entity: { eid: 'b' }, slide: { ord: 1 } },
    { entity: { eid: 'a' }, slide: { ord: 2 } },
  ])
  assertEquals(move(slides, 'a', -1), [])
  assertEquals(move(slides, 'c', 1), [])
})

test('playing goes round, and an edit keeps the slide on screen', () => {
  assertEquals([step(0, 3, 1), step(2, 3, 1), step(0, 3, -1)], [1, 0, 2])
  assertEquals(step(0, 0, 1), 0)
  let slides = [slide('a', 1), slide('b', 2), slide('c', 3)]
  assertEquals(keep(slides, 'c', 0), 2)
  assertEquals(keep(slides, 'gone', 5), 2)
  assertEquals(keep([], 'gone', 5), 0)
})

test('a slide without a photo is words, and unknown settings fall back', () => {
  assertEquals(layoutOf(slide('a', 1, { layout: 'side' })), 'words')
  assertEquals(layoutOf(slide('a', 1, { photo: 'p', layout: 'side' })), 'side')
  assertEquals(layoutOf(slide('a', 1, { photo: 'p', layout: 'odd' })), 'photo')
  assertEquals([lookOf(show(8, 'night')), lookOf(show(8, 'odd'))], [
    'night',
    'warm',
  ])
  assertEquals([paceOf(show()), paceOf(show(0)), paceOf(show(5000))], [
    8,
    0,
    600,
  ])
})

test('a photo is sent no larger than it needs to be', () => {
  assertEquals(fit(4032, 3024), [2048, 1536])
  assertEquals(fit(3024, 4032, 1000), [750, 1000])
  assertEquals(fit(800, 600), [800, 600])
})

test('a show is summed up the way a person says it', () => {
  assertEquals(summary(show(8), 6), '6 slides, 8 seconds each')
  assertEquals(summary(show(0), 1), '1 slide, moved on by hand')
  assertEquals(summary(show(8), 0), '0 slides')
})

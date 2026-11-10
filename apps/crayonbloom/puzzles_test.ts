import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { dots, maze, profile, wordSearch } from './puzzles.ts'
import { puzzlePdf } from './puzzle-pdf.ts'
import { font } from '../printbound/font_fixture.ts'
import { PDFDocument } from 'pdf-lib'

test('a seeded maze has a unique connected path from entrance to exit at each age', () => {
  for (let age of ['2-4', '4-8', '8-12', '13+']) {
    let result = maze(profile(age).maze, 42),
      seen = new Set([0]),
      todo = [0],
      openings = 0
    while (todo.length) {
      let at = todo.pop()!,
        r = Math.floor(at / result.size),
        c = at % result.size
      result.cells[at].forEach((wall, direction) => {
        if (wall) return
        let [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][direction],
          y = r + dr,
          x = c + dc
        if (y < 0 || x < 0 || y >= result.size || x >= result.size) return
        openings++
        let next = y * result.size + x
        if (!seen.has(next)) {
          seen.add(next)
          todo.push(next)
        }
      })
    }
    assertEquals(seen.size, result.size ** 2)
    assertEquals(openings / 2, result.size ** 2 - 1)
    assertEquals(result, maze(profile(age).maze, 42))
  }
})
test('a word search has varied filler and recoverable placements', () => {
  let puzzle = wordSearch(12, ['RIVER', 'BRIDGE', 'TREEHOUSE'], 9)
  for (let placed of puzzle.placements) {
    assertEquals(
      placed.cells.map(([r, c]) => puzzle.grid[r][c]).join(''),
      placed.word,
    )
  }
  assert(new Set(puzzle.grid.flat()).size > 15)
  assertEquals(puzzle, wordSearch(12, ['RIVER', 'BRIDGE', 'TREEHOUSE'], 9))
})
test('dot puzzles preserve the story theme inside the toddler dot budget', () => {
  let shape = dots('A whale in the ocean', profile('2-4').dots, 42)
  assert(shape.points.length <= 13)
  assert(shape.keywords.includes('WHALE') || shape.keywords.includes('OCEAN'))
})
test('deterministic puzzles download as one-page printable PDFs', async () => {
  for (let activity of ['maze', 'word_search', 'connect_the_dots']) {
    let bytes = await puzzlePdf(
      activity,
      '4-8',
      'A river near the treehouse',
      42,
      font,
    )
    let doc = await PDFDocument.load(bytes)
    assertEquals(doc.getPageCount(), 1)
    assertEquals(doc.getPage(0).getSize(), { width: 612, height: 792 })
  }
})

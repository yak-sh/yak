import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { dots, maze, profile, words, wordSearch } from './puzzles.ts'

export let puzzlePdf = async (
  activity: string,
  age: string,
  text: string,
  seed: number,
  fontBytes: Uint8Array,
) => {
  let doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  let font = await doc.embedFont(fontBytes, { subset: true }),
    page = doc.addPage([612, 792]),
    band = profile(age)
  let label = (text: string, x: number, y: number, size = 14) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })
  let line = (x: number, y: number, xx: number, yy: number) =>
    page.drawLine({ start: { x, y }, end: { x: xx, y: yy }, thickness: 1.5 })
  if (activity === 'maze') {
    let { size, cells } = maze(band.maze, seed), step = 480 / size
    label('Find your way through the maze', 66, 725, 20)
    cells.forEach((walls, i) => {
      let x = 66 + i % size * step, y = 650 - Math.floor(i / size) * step
      if (walls[0]) line(x, y, x + step, y)
      if (walls[3]) line(x, y, x, y - step)
      if (i % size === size - 1 && walls[1]) {
        line(x + step, y, x + step, y - step)
      }
      if (Math.floor(i / size) === size - 1 && walls[2]) {
        line(x, y - step, x + step, y - step)
      }
    })
  } else if (activity === 'word_search' && band.types.includes(activity)) {
    let puzzle = wordSearch(
        band.words,
        words(text, band.words, band.count),
        seed,
      ),
      step = 480 / band.words
    label('Find the story words', 66, 725, 20)
    puzzle.grid.forEach((row, r) =>
      row.forEach((letter, c) =>
        label(letter, 66 + c * step, 665 - r * step, step * .65)
      )
    )
    puzzle.placements.forEach((p, i) =>
      label(p.word, 66 + i % 3 * 165, 145 - Math.floor(i / 3) * 20, 12)
    )
  } else {
    let shape = dots(text, band.dots, seed)
    label('Connect the dots to reveal ' + shape.label, 66, 725, 18)
    shape.points.forEach(([x, y], i) => {
      page.drawCircle({ x: 85 + x * 435, y: 180 + y * 470, size: 2.1 })
      label(String(i + 1), 91 + x * 435, 186 + y * 470, 11)
    })
    for (let stroke of shape.interiors ?? []) {
      for (let i = 1; i < stroke.length; i++) {
        line(
          85 + stroke[i - 1][0] * 435,
          180 + stroke[i - 1][1] * 470,
          85 + stroke[i][0] * 435,
          180 + stroke[i][1] * 470,
        )
      }
    }
  }
  return await doc.save()
}

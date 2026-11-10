import shapes from './dot-shapes.json' with { type: 'json' }
import blocked from './blocked-words.json' with { type: 'json' }

export let profiles: Record<
  string,
  { maze: number; words: number; count: number; dots: number; types: string[] }
> = {
  '2-4': {
    maze: 5,
    words: 10,
    count: 6,
    dots: 13,
    types: ['connect_the_dots', 'maze'],
  },
  '4-8': {
    maze: 10,
    words: 12,
    count: 10,
    dots: 100,
    types: ['word_search', 'connect_the_dots', 'maze'],
  },
  '8-12': {
    maze: 14,
    words: 14,
    count: 12,
    dots: 100,
    types: ['word_search', 'connect_the_dots', 'maze'],
  },
  '13+': {
    maze: 18,
    words: 16,
    count: 12,
    dots: 100,
    types: ['word_search', 'connect_the_dots', 'maze'],
  },
}
export let profile = (age: string) => profiles[age] ?? profiles['4-8']
export let random = (seed: number) => () => {
  seed = Math.imul(seed ^ seed >>> 16, 0x21f0aaad)
  seed = Math.imul(seed ^ seed >>> 15, 0x735a2d97)
  return ((seed ^ seed >>> 15) >>> 0) / 4294967296
}
export let maze = (size: number, seed: number) => {
  let pick = random(seed),
    cells = Array.from({ length: size * size }, () => [true, true, true, true]),
    seen = new Set([0]),
    stack = [0]
  while (stack.length) {
    let at = stack.at(-1)!, row = Math.floor(at / size), col = at % size
    let options = [[row - 1, col, 0, 2], [row, col + 1, 1, 3], [
      row + 1,
      col,
      2,
      0,
    ], [row, col - 1, 3, 1]].filter(([r, c]) =>
      r >= 0 && r < size && c >= 0 && c < size && !seen.has(r * size + c)
    )
    if (!options.length) {
      stack.pop()
      continue
    }
    let [r, c, wall, opposite] = options[Math.floor(pick() * options.length)],
      next = r * size + c
    cells[at][wall] = false
    cells[next][opposite] = false
    seen.add(next)
    stack.push(next)
  }
  cells[0][3] = false
  cells.at(-1)![1] = false
  return { size, cells }
}
let dirs = [-1, 0, 1].flatMap((r) => [-1, 0, 1].map((c) => [r, c])).filter((
  [r, c],
) => r || c)
export let words = (text: string, size: number, count: number) =>
  [...new Set(text.toUpperCase().match(/[A-Z]{4,}/g) ?? [])].filter((word) =>
    word.length <= size && !blocked.includes(word)
  ).slice(0, count)
export let wordSearch = (size: number, input: string[], seed: number) => {
  let pick = random(seed)
  for (let attempt = 0; attempt < 40; attempt++) {
    let grid = Array.from(
      { length: size },
      () => Array.from({ length: size }, () => ''),
    )
    let placements: { word: string; cells: number[][] }[] = []
    for (let word of input.filter((word) => !blocked.includes(word))) {
      for (let trial = 0; trial < 100; trial++) {
        let [dr, dc] = dirs[Math.floor(pick() * dirs.length)],
          r = Math.floor(pick() * size),
          c = Math.floor(pick() * size)
        let cells = [...word].map((_, i) => [r + dr * i, c + dc * i])
        if (
          cells.some(([r, c], i) =>
            r < 0 || c < 0 || r >= size || c >= size ||
            grid[r][c] !== '' && grid[r][c] !== word[i]
          )
        ) continue
        cells.forEach(([r, c], i) => {
          grid[r][c] = word[i]
        })
        placements.push({ word, cells })
        break
      }
    }
    for (let row of grid) {
      for (let col = 0; col < row.length; col++) {
        if (!row[col]) {
          row[col] = String.fromCharCode(65 + Math.floor(pick() * 26))
        }
      }
    }
    if (!incidental(grid, placements)) return { grid, placements }
  }
  throw new Error(
    'The word search could not be composed safely. Choose different puzzle words.',
  )
}
let incidental = (
  grid: string[][],
  placements: { word: string; cells: number[][] }[],
) => {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      for (let [dr, dc] of dirs) {
        let cells: number[][] = [], text = ''
        for (let i = 0; i < grid.length; i++) {
          let y = r + dr * i, x = c + dc * i
          if (x < 0 || y < 0 || x >= grid.length || y >= grid.length) break
          cells.push([y, x])
          text += grid[y][x]
          if (!blocked.includes(text)) continue
          if (
            !placements.some((p) =>
              p.word.length > text.length &&
              cells.every(([y, x]) =>
                p.cells.some(([a, b]) => a === y && b === x)
              )
            )
          ) return true
        }
      }
    }
  }
  return false
}
export let dots = (text: string, budget: number, seed: number, index = 0) => {
  let terms = text.toUpperCase().match(/[A-Z]+/g) ?? [],
    available = shapes.filter((shape) => shape.points.length <= budget)
  let themed = available.filter((shape) =>
    shape.keywords.some((word) => terms.includes(word))
  )
  let pick = random(seed),
    sorted = available.map((shape) => ({ shape, n: pick() })).sort((a, b) =>
      a.n - b.n
    ).map(({ shape }) => shape)
  let order = [...themed, ...sorted.filter((shape) => !themed.includes(shape))]
  return order[index % order.length]
}

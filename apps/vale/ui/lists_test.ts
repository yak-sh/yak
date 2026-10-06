// Every list in the vale, drawn by its own module with the game's own
// stylesheets and laid out by Chrome at a desktop's width and a phone's:
// each icon keeps its title's line, each end its row, and picking or
// focusing a thing moves nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { chromeBin, withChrome } from '../chrome_fixture.ts'
import { LISTS, listsPage } from './lists_fixture.ts'

// In the page: every icon beside its words, every end beside the words it
// ends, where they show; how many tiles were seen, by list.
let lines = () => {
  let shown = (e: Element) => e.getClientRects().length > 0
  let box = (e: Element) => e.getBoundingClientRect()
  // The first words shown in `e`, if any show.
  let words = (e: Element) => {
    let walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent!.trim() && !n.parentElement!.closest('svg') &&
          shown(n.parentElement!)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    })
    let first = walk.nextNode()
    if (!first) return null
    let range = document.createRange()
    range.selectNodeContents(first)
    return range.getBoundingClientRect()
  }
  let beside = (a: DOMRect, b: DOMRect) =>
    a.top < b.bottom && b.top < a.bottom &&
    (a.right <= b.left + 0.5 || b.right <= a.left + 0.5)
  let wrong: string[] = [], seen: Record<string, number> = {}
  for (let list of document.querySelectorAll<HTMLElement>('[data-list]')) {
    let name = list.dataset.list!
    let say = (what: string, e: Element) =>
      wrong.push(`${name}: ${what}: ${e.textContent!.trim().slice(0, 40)}`)
    seen[name] = 0
    for (let tile of list.querySelectorAll('.Tile')) {
      let icon = tile.querySelector(':scope > .Tile_Icon')
      let title = tile.querySelector('.Tile_Title')
      let text = tile.querySelector(':scope > .Tile_Text')
      let end = tile.querySelector(':scope > .Tile_End')
      let head = tile.matches('.Tile-head')
      if (!shown(tile)) continue
      if (icon && title) seen[name]++
      if (icon && title && !beside(box(icon), box(title))) {
        say("icon off its title's line", tile)
      }
      // A head's end, what can be done, goes under its words for room.
      if (end && text && !head && !beside(box(text), box(end))) {
        say('end off its row', tile)
      }
    }
    for (let glyph of list.querySelectorAll('svg.Glyph')) {
      let head = glyph.closest('h1, h2, h3, summary, b, button, li, label')
      if (!head || glyph.closest('.Tile') || !shown(glyph)) continue
      let near = words(head)
      if (near && !beside(box(glyph), near)) {
        say("icon off its words' line", head)
      }
    }
  }
  return { wrong, seen }
}

// In the page: whatever can be picked keeps its box, and its own colours
// (its face, its frame, its rarity's), while each in turn is picked and
// given the keyboard.
let still = () => {
  let wrong: string[] = []
  let paint = (e: Element) =>
    [e, ...e.querySelectorAll('.Rarity, .Tile_Icon, .Tile_Title')].map((x) => {
      let c = getComputedStyle(x)
      return [c.color, c.backgroundColor, c.boxShadow, c.borderColor].join()
    }).join(';')
  for (let list of document.querySelectorAll<HTMLElement>('[data-list]')) {
    let picks = [...list.querySelectorAll<HTMLElement>('[aria-current]')]
      .filter((e) => e.getClientRects().length)
    let pick = (one?: Element) =>
      picks.forEach((e) => e.setAttribute('aria-current', String(e == one)))
    let boxes = () =>
      picks.map((e) => JSON.stringify(e.getBoundingClientRect())).join()
    pick()
    let before = boxes(), paints = picks.map(paint)
    picks.forEach((one, i) => {
      let say = (what: string) =>
        wrong.push(`${list.dataset.list}: ${what}: ${one.textContent!.trim()}`)
      pick(one)
      one.focus({ preventScroll: true })
      if (boxes() != before) say('moves')
      if (paint(one) != paints[i]) say('loses its own colours')
    })
  }
  return wrong
}

let call = (fn: () => unknown) => `(${fn})()`

test(
  'every list keeps its icons on their lines and moves nothing when picked, on a desktop and a phone',
  async () => {
    let file = await listsPage()
    try {
      await withChrome(async (tab) => {
        await tab.open(`file://${file}`)
        for (let [width, height] of [[1280, 800], [390, 844]]) {
          await tab.size(width, height)
          // As drawn, with a thing picked, then with each list showing, as Back
          // shows it on a phone.
          for (let back of [false, true]) {
            if (back) {
              await tab.run(
                `document.querySelectorAll('.Split').forEach((s) => s.classList.remove('Split-picked'))`,
              )
            }
            let { wrong, seen } = await tab.run<ReturnType<typeof lines>>(
              call(lines),
            )
            assertEquals(wrong, [], `${width}px`)
            if (back) {
              for (let [name] of LISTS) {
                assertEquals(seen[name] > 0, true, `${name} at ${width}px`)
              }
            }
          }
          assertEquals(await tab.run(call(still)), [], `${width}px`)
        }
      })
    } finally {
      await Deno.remove(file)
    }
  },
  { skip: !chromeBin },
)

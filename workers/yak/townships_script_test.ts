// The townships page's calculator (public/township-dues.js), typed into as a
// person would. The township app's own deadlines.js is served from the demo
// space and holds its own tests, so here it is stood in for by a module that
// answers fixed dates and keeps what it was asked: what is under test is the
// instant the page asks about, in its zone, and what the page says back.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { page } from './site/mod.ts'
import { DUES } from './site/townships.tsx'

let code = await Deno.readTextFile(
  new URL('./public/township-dues.js', import.meta.url),
)

let asked: unknown[][] = []
;(globalThis as { asked?: unknown[][] }).asked = asked
let stand = 'export let dues = (starts, zone) => (globalThis.asked.push(' +
  "[starts, zone]), { proposed: '2026-11-20', approved: '2026-11-16', " +
  "notice: '2026-11-09T01:00:00.000Z' })"

// The page with its script run against the stand-in, and `type`, which sets
// the fields named and answers what the page then says, line by line.
let opened = async () => {
  let { document, Event } = parseHTML(page('townships.html'))
  let block = document.querySelector('[data-dues]') as HTMLElement
  let served = block.dataset.dues
  block.dataset.dues = `data:text/javascript,${encodeURIComponent(stand)}`
  let before = block.hidden
  new Function('document', code)(document)
  while (block.hidden) await new Promise((r) => setTimeout(r, 1))
  let type = (fields: Record<string, string | boolean>) => {
    asked.length = 0
    for (let [name, value] of Object.entries(fields)) {
      let field = document.getElementById(`dues-${name}`) as HTMLInputElement
      if (typeof value == 'boolean') field.checked = value
      else if (field.tagName == 'SELECT') {
        for (let o of field.querySelectorAll('option')) {
          o.toggleAttribute('selected', o.value == value)
        }
      } else field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return [...block.querySelectorAll('.Dues_Said li')]
      .map((li) => li.textContent)
  }
  return { served, before, type }
}

test("township dues: the page counts with the township app's own function, shown once it loads", async () => {
  let { served, before, type } = await opened()
  assertEquals([served, before], [DUES, true])
  assertEquals(type({}), [])
})

test('township dues: a meeting is asked about at its start in its own zone, and its dates are said with the law', async () => {
  let { type } = await opened()
  let said = [
    'Proposed minutes: available by Friday, November 20, 2026, 8 business days after the meeting (MCL 15.269).',
    'Minutes this meeting approves: available by Monday, November 16, 2026, 5 business days after it (MCL 15.269).',
  ]
  assertEquals(type({ day: '2026-11-09', time: '19:00' }), said)
  assertEquals(asked.at(-1), ['2026-11-10T00:00:00.000Z', 'America/Detroit'])
  // Daylight time, and Central.
  type({ day: '2027-07-01', time: '19:00', zone: 'America/Chicago' })
  assertEquals(asked.at(-1), ['2027-07-02T00:00:00.000Z', 'America/Chicago'])
})

test("township dues: a special meeting's notice needs its start time", async () => {
  let { type } = await opened()
  assertEquals(
    type({ day: '2026-11-09', special: true }).at(-1),
    'Notice: type the time it starts to see when it must be posted.',
  )
  assertEquals(
    type({ time: '19:00' }).at(-1),
    'Notice: posted by Sunday, November 8 at 8:00 PM, 18 hours before the meeting starts (MCL 15.265).',
  )
})

// What a person pays now, summed beside the plan's price (public/saving.js),
// typed into as a person would, over the organizations page.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { PRICE } from './meter.ts'
import { page } from './site/mod.ts'

let code = await Deno.readTextFile(
  new URL('./public/saving.js', import.meta.url),
)

// The page with its script run, and `pay`, which types an amount in a field
// and answers what the page then says.
let opened = () => {
  let { document, Event } = parseHTML(page('organizations.html'))
  let block = document.querySelector('[data-saving]') as HTMLElement
  let before = block.hasAttribute('hidden')
  new Function('document', code)(document)
  let said = () => block.querySelector('output')!.textContent
  let pay = (field: string, amount: string) => {
    let input = document.getElementById(`pay-${field}`) as HTMLInputElement
    input.value = amount
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return said()
  }
  return { hidden: [before, block.hasAttribute('hidden')], said, pay }
}

test('saving: the fields show once the script runs, and say nothing until typed in', () => {
  let { hidden, said } = opened()
  assertEquals(hidden, [true, false])
  assertEquals(said(), '')
})

test('saving: what they pay is summed and set beside the plan', () => {
  let { pay } = opened()
  pay('website', '30')
  pay('forms', '25.50')
  let paid = PRICE.pro + 126
  assertEquals(
    pay('directory', String(paid - 55.5)),
    `You pay $${paid} a month for these. They are $${PRICE.pro} a month ` +
      'here, which is $126 less each month and $1,512 less each year.',
  )
})

test('saving: a sum no more than the plan says the plan saves nothing', () => {
  let { pay } = opened()
  let none =
    `You pay $20 a month for these, which is no more than the $${PRICE.pro} ` +
    'plan. It would not save you money.'
  assertEquals(pay('website', '20'), none)
  // Words and an amount below nothing count for nothing, and a page emptied
  // again says nothing.
  assertEquals([pay('calendar', '-5'), pay('forms', 'ten')], [none, none])
  assertEquals(pay('website', ''), '')
})

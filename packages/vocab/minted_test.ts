import { equal, test } from '@yaks/testing'
import { minted } from './minted.ts'

// Ids 1, 2, 3, … in mint order, so a case can say which word got which.
let counting = () => {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}
let id = (n: number) =>
  `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let mint = (text: string) => minted(text, counting())
let json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

test('every word without a $id gets one, as the first member', () => {
  let text = json({
    title: 'pins',
    $defs: {
      pin: { component: true, properties: { at: { type: 'string' } } },
      pin_set: { tool: true, input: { properties: { x: {} } } },
    },
    kinds: { pin: { description: 'a pin' }, place: { is: ['pin'] } },
  })
  equal(
    mint(text),
    json({
      $id: id(1),
      title: 'pins',
      $defs: {
        pin: {
          $id: id(2),
          component: true,
          properties: { at: { $id: id(3), type: 'string' } },
        },
        pin_set: { tool: true, input: { properties: { x: {} } } },
      },
      kinds: {
        pin: { $id: id(2), description: 'a pin' },
        place: { $id: id(4), is: ['pin'] },
      },
    }),
  )
})

test('an extends entry keeps no $id of its own; what it adds gets one', () => {
  let doc = JSON.parse(mint(json({
    $id: id(9),
    $defs: {
      task: { component: true, extends: true, properties: { due: {} } },
    },
  })))
  equal(doc.$defs.task.$id, undefined)
  equal(doc.$defs.task.properties.due.$id, id(1))
})

test('a text whose words all carry a $id comes back as it was', () => {
  let text = mint(json({ $defs: { pin: { component: true } } }))
  equal(minted(text, () => 'never'), text)
})

test('the text keeps its layout: inline objects stay inline', () => {
  let text = '{\n  "$defs": {\n    "pin": {\n      "component": true,\n' +
    '      "properties": { "at": { "type": "string" }, "x": {} }\n    }\n  }\n}\n'
  equal(
    mint(text),
    `{\n  "$id": "${id(1)}",\n  "$defs": {\n    "pin": {\n` +
      `      "$id": "${id(2)}",\n      "component": true,\n` +
      `      "properties": { "at": { "$id": "${id(3)}", "type": "string" }, ` +
      `"x": { "$id": "${id(4)}" } }\n    }\n  }\n}\n`,
  )
})

test('keys with escapes and brackets in strings do not lose the place', () => {
  let doc = JSON.parse(mint(json({
    $defs: {
      'a"{[': { component: true, description: 'x { y [ z', properties: {} },
      b: { component: true, enum: ['{', ']'], properties: { c: {} } },
    },
  })))
  equal(doc.$defs['a"{['].$id, id(2))
  equal(doc.$defs.b.properties.c.$id, id(4))
})

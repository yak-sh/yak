import { equal, test } from '@yaks/testing'
import { merge } from './merge.ts'

let json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

// [name, path, ours, live, base, merged, conflict]
let cases: [string, string, string, string, string, string, boolean][] = [
  [
    'a key both added keeps the platform’s value, once',
    'vocab.json',
    '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n',
    '{\n  "a": 1,\n  "c": 4,\n  "b": 2\n}\n',
    '{\n  "a": 1,\n  "b": 2\n}\n',
    '{\n  "a": 1,\n  "c": 4,\n  "b": 2\n}\n',
    true,
  ],
  [
    'separate keys merge at any depth',
    'vocab.json',
    json({ cue: { type: 'object', properties: { at: 1, why: 2 } } }),
    json({ cue: { type: 'object', properties: { at: 1, take: 3 } } }),
    json({ cue: { type: 'object', properties: { at: 1 } } }),
    json({ cue: { type: 'object', properties: { at: 1, why: 2, take: 3 } } }),
    false,
  ],
  [
    'a key one side removed stays removed',
    'vocab.json',
    json({ a: 1 }),
    json({ a: 1, b: 2, c: 3 }),
    json({ a: 1, b: 2 }),
    json({ a: 1, c: 3 }),
    false,
  ],
  [
    'an array merges whole',
    'deno.json',
    json({ list: [1, 2] }),
    json({ list: [1, 3] }),
    json({ list: [1] }),
    json({ list: [1, 3] }),
    true,
  ],
  [
    'JSON that does not parse merges by line',
    'deno.json',
    '{\n  // ours\n  "a": 1\n}\n',
    '{\n  "a": 1\n}\n// live\n',
    '{\n  "a": 1\n}\n',
    '{\n  // ours\n  "a": 1\n}\n// live\n',
    false,
  ],
  [
    'a lock both changed is a conflict, never merged',
    'package-lock.json',
    json({ a: 2, b: 1 }),
    json({ a: 1, b: 2 }),
    json({ a: 1, b: 1 }),
    json({ a: 1, b: 2 }),
    true,
  ],
]

for (let [name, path, ours, live, base, content, conflict] of cases) {
  test(`merge: ${name}`, () =>
    equal(merge(path, ours, live, base), { content, conflict }))
}

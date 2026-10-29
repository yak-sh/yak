// What a change did, in words, read from its Automerge 0.9.2 ops: the root
// object is all zeros, the doc's title is a key on it, and its body is a Text
// object whose characters are inserted (`ins` places an element, the `set`
// after it gives the character) and deleted one element at a time.

export let ROOT = '00000000-0000-0000-0000-000000000000'

/// quoted('hi\nthere', 7) -> '“hi↵t…”'
/** Text shown inside quotes, newlines drawn, cut at `max` characters. */
export let quoted = (s, max = 24) => {
  let t = s.replace(/\n/g, '↵')
  return `“${t.length > max ? t.slice(0, max - 3) + '…' : t}”`
}

/// let set = (obj, key, value) => ({ action: 'set', obj, key, value })
/// describe({ ops: [{ action: 'makeText', obj: 't' }, set(ROOT, 'title', '')] }) -> 'Created the doc'
/// describe({ ops: [{ action: 'ins', obj: 't', key: '_head', elem: 1 }, set('t', 'a:1', 'h'), set('t', 'a:2', 'i')] }) -> 'Typed “hi”'
/// describe({ ops: [{ action: 'del', obj: 't', key: 'a:1' }, set(ROOT, 'title', 'Plans')] }) -> 'Deleted 1 character, titled it “Plans”'
/// describe({ ops: [] }) -> 'No change'
/** A change's ops said in a few words. */
export let describe = (change) => {
  let ops = change?.ops ?? []
  if (ops.some((o) => o.action == 'makeText')) return 'Created the doc'
  let typed = ops.filter((o) => o.action == 'set' && o.obj != ROOT)
    .map((o) => o.value).join('')
  let cut = ops.filter((o) => o.action == 'del' && o.obj != ROOT).length
  let title = ops.findLast((o) =>
    o.action == 'set' && o.obj == ROOT && o.key == 'title'
  )
  let said = [
    typed && `Typed ${quoted(typed)}`,
    cut && `Deleted ${cut} character${cut == 1 ? '' : 's'}`,
    title &&
    (title.value ? `titled it ${quoted(title.value)}` : 'cleared the title'),
  ].filter(Boolean).join(', ')
  return said ? said[0].toUpperCase() + said.slice(1) : 'No change'
}

/// let name = (a) => a.toUpperCase()
/// op({ action: 'ins', obj: 't', key: '_head', elem: 3 }, name) -> ['ins', 'at the start, as element 3']
/// op({ action: 'ins', obj: 't', key: 'ab:2', elem: 3 }, name) -> ['ins', 'after AB:2, as element 3']
/// op({ action: 'set', obj: 't', key: 'ab:3', value: 'x' }, name) -> ['set', 'AB:3 to “x”']
/// op({ action: 'set', obj: ROOT, key: 'title', value: 'Hi' }, name) -> ['set', 'title to “Hi”']
/** One op as its action and a line saying what it touches. */
export let op = (o, name) => {
  let elem = (k) => {
    let [a, n] = String(k).split(':')
    return n ? `${name(a)}:${n}` : k
  }
  let value = o.value === undefined ? '' : ` to ${quoted(String(o.value))}`
  return [
    o.action,
    o.action == 'ins'
      ? `${
        o.key == '_head' ? 'at the start' : `after ${elem(o.key)}`
      }, as element ${o.elem}`
      : o.action == 'makeText'
      ? 'a new Text object'
      : o.action == 'link'
      ? `${o.key} to the Text object`
      : o.obj == ROOT
      ? `${o.key}${value}`
      : `${elem(o.key)}${value}`,
  ]
}

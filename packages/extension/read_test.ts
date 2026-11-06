import { equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { read } from './read.ts'

// Every document is parsed as the file loads, so a case times only `read`.
let doc = (body: string, title = '') =>
  parseHTML(
    `<html><head><title>${title}</title></head><body>${body}</body></html>`,
  ).document
let reads = (cases: [string, string][]) =>
  cases.map(([body, text]) => [doc(body), text] as const)

let BLOCKS = reads([
  [
    '<h1>Rain</h1><p>falls  on\n  <b>the</b>   plain</p>',
    'Rain\nfalls on the plain',
  ],
  ['<ul><li>one</li><li> two </li></ul>after', 'one\ntwo\nafter'],
  ['<p>a<br>b</p>', 'a\nb'],
  ['<p>code:</p><pre>if x:\n    go()</pre>', 'code:\nif x:\n    go()'],
])
let UNSEEN = doc(
  '<p>seen</p><script>no()</script><style>p{}</style><noscript>no</noscript>' +
    '<div hidden>no</div><span aria-hidden="true">no</span>' +
    '<p style="color: red; display: none">no</p><p style="visibility:hidden">no</p>' +
    '<template><p>no</p></template><input value="no"><textarea>no</textarea>',
)
let TITLED = doc('<p>hi</p>', '  A \n Page ')
let LONG = doc('<p>abcdefghij</p>')
let TWO = doc('<p>a</p><script>x</script><p>b</p>')
// A parsed document's first walk sets up its lazy parts; no case times that.
read(doc('<p>warm</p>'), '')

test('the text is what a person sees, one line per block, a pre as it is', () => {
  for (let [d, text] of BLOCKS) equal(read(d, '').text, text)
})

test('scripts, styles and hidden elements are not read', () => {
  equal(read(UNSEEN, '').text, 'seen')
})

test('the title and the selection are read, whitespace trimmed', () => {
  let page = read(TITLED, '  picked  words ')
  equal([page.title, page.selection], ['A Page', 'picked  words'])
})

test('a long page is cut at the limit, with a note saying so', () => {
  match(read(LONG, 'abcdefghij', 4), {
    text: 'abcd\n[The text is cut here, at 4 of its 10 characters.]',
    selection: 'abcd\n[The selection is cut here, at 4 of its 10 characters.]',
  })
  equal(read(LONG, '', 10).text, 'abcdefghij')
})

test('read closes over nothing, so it runs from its source in a page', () => {
  equal(new Function(`return ${read}`)()(TWO).text, 'a\nb')
})

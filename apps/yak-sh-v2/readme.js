// A package's README, as the manual shows it: fetched from the repository's
// main branch, parsed and drawn by @yaks/markdown into Preact's elements, and
// its links pointed where they lead: another package's README opens in the
// manual too (`data-pkg`), and anything else in the repository opens on
// GitHub.

let RAW = 'https://raw.githubusercontent.com/yak-sh/yak/main/packages/'
let TREE = 'https://github.com/yak-sh/yak/blob/main/packages/'

// `…/packages/graph`, `…/packages/graph/` or `…/packages/graph/README.md`:
// the package a link names, if it names one.
let pkgOf = (url) =>
  url.href.match(/\/packages\/([a-z0-9-]+)\/?(?:README\.md)?(?:#.*)?$/)?.[1]

let parts = {
  p: 'Body_Paragraph',
  ol: 'Body_Ordered',
  ul: 'Body_Unordered',
  li: 'Body_Item',
  pre: 'Body_Source',
  table: 'Body_Table',
  thead: 'Body_Head',
  tbody: 'Body_Rows',
  tr: 'Body_Row',
  th: 'Body_HeadingCell',
  td: 'Body_Cell',
  a: 'Body_Link',
  img: 'Body_Image',
  blockquote: 'Body_Quote',
  code: 'Body_Code',
  hr: 'Body_Rule',
  strong: 'Body_Strong',
  em: 'Body_Emphasis',
}

let part = (tag) =>
  /^h[1-6]$/.test(tag)
    ? `Body_Heading Body_Heading-${tag.slice(1)}`
    : parts[tag]

/** The README of `@yaks/<name>`, drawn into a new `.Readme` element. */
export let readme = async (name) => {
  let [{ parse, render }, { h, render: mount }, res] = await Promise.all([
    import('@yaks/markdown'),
    import('preact'),
    fetch(`${RAW}${name}/README.md`),
  ])
  if (!res.ok) throw new Error(`no README for @yaks/${name} (${res.status})`)
  let box = document.createElement('div')
  box.className = 'Readme'
  let host = (tag, props, ...kids) =>
    h(tag, {
      ...props,
      class: [props?.class, part(tag)].filter(Boolean).join(' '),
    }, ...kids)
  mount(render(parse(await res.text(), { breaks: false }), host), box)
  // Its headings' anchors are prefixed, so none of them can be taken for one
  // of the page's own sections; a link within the README follows them.
  for (let heading of box.querySelectorAll('[id]')) {
    heading.id = `r-${heading.id}`
  }
  let base = `${TREE}${name}/`
  for (let a of box.querySelectorAll('a[href]')) {
    let raw = a.getAttribute('href')
    if (raw.startsWith('#')) {
      a.setAttribute('href', `#r-${raw.slice(1)}`)
      continue
    }
    let url = new URL(raw, base)
    let pkg = pkgOf(url)
    a.href = url.href
    if (pkg) a.dataset.pkg = pkg
  }
  return box
}

// The modules a platform page loads once for all its scripts: each a bare
// specifier the scripts leave unbundled (assets.ts), and the file that
// answers it, which the page's import map names (pages.ts). The page graph's
// client is one, so a tab fetches and runs its code once and every script on
// the page holds the same graph. React and React DOM are the others, so a page
// runs one React however many of its scripts draw with it (./react/).

/** Each shared specifier, and the asset that answers it. */
export let SHARED: Record<string, string> = {
  '@yaks/client': '_page-client.js',
  'react': '_react.js',
  'react/jsx-runtime': '_react-jsx.js',
  'react-dom': '_react-dom.js',
  'react-dom/client': '_react-dom-client.js',
}

/** The page's import map, each shared specifier at the address `file` gives
 * its asset. */
export let importMap = (file: (name: string) => string): string =>
  `<script type="importmap">${
    JSON.stringify({
      imports: Object.fromEntries(
        Object.entries(SHARED).map((
          [specifier, name],
        ) => [specifier, file(name)]),
      ),
    })
  }</script>`

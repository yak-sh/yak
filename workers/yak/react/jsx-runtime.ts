// `react/jsx-runtime` for the platform's pages, which their import map names
// (../page-imports.ts): each page script leaves it unbundled, so a page runs
// one React however many scripts it has. React is CommonJS, whose names an
// ES module must say (./react_test.ts checks they are all here).
import * as module from 'react/jsx-runtime'

// Its types leave some of its names out.
let named: typeof module & Record<string, unknown> = module

export let {
  Fragment,
  jsx,
  jsxs,
} = named

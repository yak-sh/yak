---
name: sandbox
description: "Sandbox (yaks.app). The sandbox: a private Linux container in the space where an agent runs commands and keeps files while it works, through sandbox_write, sandbox_shell, sandbox_wait, sandbox_stop, sandbox_read and sandbox_ship. Its uses (a script over an attachment, a CSV reconciled against an app's data, an API call, compiling to WebAssembly, building a site), the installed document tools and toolchains, installing more, how long its files last, copying files into an app with sandbox_ship, its network, how many may be awake and the monthly compute time, and the yak CLI and $YAKS_TOKEN it is signed in with."
---

# Sandbox

The **sandbox** is a private Linux container in the space where an agent runs
commands and keeps files while it works. `sandbox_write` puts a file in,
`sandbox_shell` runs a command, `sandbox_read` reads a file out, and
`sandbox_ship` copies files into an app.

## Uses

- Run a script over an attachment: `sandbox_write` with the attachment's id
  writes its bytes to a file, and a Python or Deno script parses it.
- Reconcile a CSV against the app's data, through `yak` (below).
- Call an API, or clone a repository.
- Compile code a browser can't run as written, such as a chess engine, an image
  codec or a solver, to WebAssembly.
- Build a site with Vite, Astro, Eleventy or SvelteKit, and ship its output.

## Installed tools

Preinstalled:

    Rust 1.98.1      with wasm32-unknown-unknown, wasm-bindgen 0.2.128,
                     wasm-opt 132
    Python 3.13.15   with pip, pypdf, pdfplumber, python-docx, openpyxl,
                     python-pptx, pandas and Pillow
    pandoc           document format conversion
    poppler-utils    pdftotext, pdftoppm, pdfinfo and other PDF utilities
    LibreOffice      Writer, Calc and Impress, run with --headless
    Go 1.27.1        GOOS=js GOARCH=wasm, and lib/wasm/wasm_exec.js beside it
    Zig 0.16.0       and with it C and C++: `zig cc`, `zig c++`
    Deno 2.9.1       plus the Node and Bun the base image ships

`zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry` is the shortest
way from C to a WebAssembly module a browser instantiates with no glue code; the
`wasm32-wasi` target produces one that runs under a WASI shim. C++ takes the
same flags, with `-fno-exceptions`.

Commands run as root, so `apt-get install -y <package>`, `cargo`, `pip`, `npm`
and `go get` all work, and nothing installed outlives the container.

## Document files

`sandbox_write` with `attachment` and a path copies an attachment's original
bytes into the sandbox. Run a script with `sandbox_shell` to read or change the
file:

| File                                   | Installed tools                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PDF                                    | pypdf for pages, merging and writing; pdfplumber for text and tables; pdftotext for text; pdftoppm for rendering pages |
| Word (.docx)                           | python-docx for reading, editing and writing documents                                                                 |
| Excel (.xlsx)                          | openpyxl for reading, editing and writing workbooks; pandas for tabular data                                           |
| PowerPoint (.pptx)                     | python-pptx for reading, editing and writing presentations                                                             |
| CSV                                    | Python's csv module and pandas                                                                                         |
| Images                                 | Pillow for reading, resizing, compositing and writing images                                                           |
| Markdown, HTML and document conversion | pandoc, including DOCX input and output                                                                                |
| Office rendering and conversion        | LibreOffice Writer, Calc and Impress with --headless, including PDF output                                             |

For example, after copying a PDF to `/workspace/input.pdf` and a workbook to
`/workspace/input.xlsx`, this Python script reads both and writes a DOCX:

```python
from pypdf import PdfReader
from openpyxl import load_workbook
from docx import Document

document = Document()
for page in PdfReader('/workspace/input.pdf').pages:
    document.add_paragraph(page.extract_text() or '')
workbook = load_workbook('/workspace/input.xlsx', read_only=True, data_only=True)
for row in workbook.active.iter_rows(values_only=True):
    document.add_paragraph(' | '.join('' if value is None else str(value) for value in row))
workbook.close()
document.save('/workspace/output.docx')
```

PDF text extraction needs a text layer; scanned pages need OCR. openpyxl reads
cached formula results with `data_only=True`; it does not calculate formulas.
`sandbox_read` returns text, so inspect binary output through a command or keep
it in an app with `sandbox_ship`.

To render an office file as PDF, use
`libreoffice --headless --convert-to pdf --outdir /workspace/rendered /workspace/output.docx`.
Fonts and layout can differ from the application that created the original.

## Files

A sandbox's files are temporary. It goes to sleep five minutes after its last
command, and a managed build destroys it when the build ends, with everything in
it. Only the files `sandbox_ship` copied into the app are kept.

## Copying files into an app with `sandbox_ship`

`sandbox_ship` keeps a folder's structure. Name a file, a folder or a glob in
the sandbox. A folder copies every file inside it, so a site built into `dist/`
lands where its pages expect its files:

    sandbox_ship(app, paths: ['dist'])
      dist/index.html        → index.html
      dist/about/index.html  → about/index.html
      dist/_astro/app.js     → _astro/app.js

A file, or each file a glob matched, is copied under its own name, relative to
the folder its matches share, so `pkg/*.wasm` lands beside `index.html` and
`dist/*` lands the same way `dist` does. `into: 'dist'` puts everything shipped
under that folder of the app instead of its root. Two different files that would
land on the same path are refused. `replace: true`, with `into`, makes that
folder contain exactly what this call ships: each file an earlier call left
there is deleted, and kept in its history like any other delete.

## Network

The sandbox has full internet access. `git clone` from GitHub, a scaffolder that
downloads its template (`npm create astro`), any registry and any API all work.

## Limits

Your sandbox is private to you in each space, and a space can have one sandbox
awake at a time on the free plan, two on the Plus plan. A sandbox goes to sleep
five minutes after its last command, and another member's sandbox in that space
can wake after that. The monthly compute time (the sandbox's, and compiling
TypeScript and npm packages at `app_deploy`) is 1 hour for each free space and
10 hours for each space on the Plus plan.

## The `yak` CLI and `$YAKS_TOKEN`

The sandbox is signed in as you. Two variables are set in every command's
environment, and the `yak` CLI is installed:

    YAKS_TOKEN   a placeholder for a grant — you, narrowed to this space
    YAKS_HOST    https://yaks.app

So a script in the sandbox can call the same tools your agent has, as you:

    yak app_list
    yak graph query '.recipe'
    yak apply @rows.ndjson

`yak <tool>` runs any tool this connector lists (it reads the list at run time,
so it always matches the connector), and `yak apply` streams a file of NDJSON
bundles into the graph 50 at a time. `curl` reaches the same MCP endpoint if you
prefer to write the JSON-RPC yourself:

    curl -sS "$YAKS_HOST/mcp" \
      -H "authorization: Bearer $YAKS_TOKEN" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":
           {"name":"app_list","arguments":{}}}'

The container never holds the grant itself. `$YAKS_TOKEN` is a placeholder, and
yaks.app replaces it with the grant in an outgoing request, only when the
request goes to yaks.app or to your space's own address (`<space>.yaks.app`,
which answers a clone of your app). Sent anywhere else, it stays a placeholder,
so printing it, or a package reading it, reveals nothing.

The grant is minted when the container wakes and **expires with the container**:
it is revoked as soon as the sandbox is destroyed, and it expires on its own
soon after the sandbox would have gone to sleep. It never has more permission
than you: it carries no permission of its own, only your membership, and only in
this space.

Deploying a site built in the sandbox, with Vite, Astro, Eleventy or SvelteKit,
is in Backend Code: <https://yaks.app/docs/code.md>.

---

The full guide: <https://yaks.app/docs.md>

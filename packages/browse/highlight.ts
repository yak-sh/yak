import type {} from 'highlight.js'
// Code highlighting is one tokenizer with two faces: safe HTML for a raw
// source view and classed runs for Markdown's code, in the browser and the
// terminal alike. Highlight.js emits only escaped text and
// spans; parsing that small vocabulary keeps the TUI independent of a DOM.
import hljs from 'highlight.js/lib/core'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import ruby from 'highlight.js/lib/languages/ruby'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import perl from 'highlight.js/lib/languages/perl'
import objectivec from 'highlight.js/lib/languages/objectivec'
import php from 'highlight.js/lib/languages/php'
import phpTemplate from 'highlight.js/lib/languages/php-template'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import pythonRepl from 'highlight.js/lib/languages/python-repl'
import r from 'highlight.js/lib/languages/r'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import yaml from 'highlight.js/lib/languages/yaml'
import typescript from 'highlight.js/lib/languages/typescript'
import vbnet from 'highlight.js/lib/languages/vbnet'
import wasm from 'highlight.js/lib/languages/wasm'

// Pages without code do not construct every language grammar during startup.
let ready = false
let grammars = () => {
  if (ready) return
  ready = true
  for (
    let [name, grammar] of Object.entries({
      xml,
      bash,
      c,
      cpp,
      csharp,
      css,
      markdown,
      diff,
      ruby,
      go,
      graphql,
      ini,
      java,
      javascript,
      json,
      kotlin,
      less,
      lua,
      makefile,
      perl,
      objectivec,
      php,
      'php-template': phpTemplate,
      plaintext,
      python,
      'python-repl': pythonRepl,
      r,
      rust,
      scss,
      shell,
      sql,
      swift,
      yaml,
      typescript,
      vbnet,
      wasm,
    })
  ) hljs.registerLanguage(name, grammar)
}

export type Token = { text: string; classes: string[] }
export type Highlight = {
  html: string
  language?: string
  lines: Token[][]
}

let unescape = (s: string) =>
  s.replace(
    /&(?:amp|lt|gt|quot|#(?:x[0-9a-f]+|\d+));/gi,
    (entity) => {
      if (entity == '&amp;') return '&'
      if (entity == '&lt;') return '<'
      if (entity == '&gt;') return '>'
      if (entity == '&quot;') return '"'
      let hex = entity[2].toLowerCase() == 'x'
      let n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
      return String.fromCodePoint(n)
    },
  )

let tokens = (html: string): Token[][] => {
  let lines: Token[][] = [[]]
  let stack: string[][] = []
  let classes: string[] = []
  let parts = html.split(/(<span class="[^"]+">|<\/span>)/)
  for (let part of parts) {
    let open = part.match(/^<span class="([^"]+)">$/)
    if (open) {
      stack.push(classes)
      classes = [...classes, ...open[1].split(/\s+/)]
    } else if (part == '</span>') {
      classes = stack.pop() ?? []
    } else {
      unescape(part).split('\n').forEach((text, i) => {
        if (i) lines.push([])
        if (text) lines[lines.length - 1].push({ text, classes })
      })
    }
  }
  return lines
}

// An explicit but unavailable grammar stays code rather than silently wearing
// a guessed language. An absent info string is the request to detect one.
export let highlight = (text: string, language?: string): Highlight => {
  grammars()
  let asked = language?.trim().split(/\s+/)[0]
  let result = asked && hljs.getLanguage(asked)
    ? hljs.highlight(text, { language: asked, ignoreIllegals: true })
    : asked
    ? { value: hljs.highlight(text, { language: 'plaintext' }).value }
    : hljs.highlightAuto(text)
  return {
    html: result.value,
    language: 'language' in result ? result.language : undefined,
    lines: tokens(result.value),
  }
}

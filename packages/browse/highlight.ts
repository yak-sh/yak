// Code highlighting is one tokenizer with two faces: safe HTML for marked and
// plain segments for the terminal. Highlight.js emits only escaped text and
// spans; parsing that small vocabulary keeps the TUI independent of a DOM.
import hljs from 'npm:highlight.js@11.11.1/lib/core'
import xml from 'npm:highlight.js@11.11.1/lib/languages/xml'
import bash from 'npm:highlight.js@11.11.1/lib/languages/bash'
import c from 'npm:highlight.js@11.11.1/lib/languages/c'
import cpp from 'npm:highlight.js@11.11.1/lib/languages/cpp'
import csharp from 'npm:highlight.js@11.11.1/lib/languages/csharp'
import css from 'npm:highlight.js@11.11.1/lib/languages/css'
import markdown from 'npm:highlight.js@11.11.1/lib/languages/markdown'
import diff from 'npm:highlight.js@11.11.1/lib/languages/diff'
import ruby from 'npm:highlight.js@11.11.1/lib/languages/ruby'
import go from 'npm:highlight.js@11.11.1/lib/languages/go'
import graphql from 'npm:highlight.js@11.11.1/lib/languages/graphql'
import ini from 'npm:highlight.js@11.11.1/lib/languages/ini'
import java from 'npm:highlight.js@11.11.1/lib/languages/java'
import javascript from 'npm:highlight.js@11.11.1/lib/languages/javascript'
import json from 'npm:highlight.js@11.11.1/lib/languages/json'
import kotlin from 'npm:highlight.js@11.11.1/lib/languages/kotlin'
import less from 'npm:highlight.js@11.11.1/lib/languages/less'
import lua from 'npm:highlight.js@11.11.1/lib/languages/lua'
import makefile from 'npm:highlight.js@11.11.1/lib/languages/makefile'
import perl from 'npm:highlight.js@11.11.1/lib/languages/perl'
import objectivec from 'npm:highlight.js@11.11.1/lib/languages/objectivec'
import php from 'npm:highlight.js@11.11.1/lib/languages/php'
import phpTemplate from 'npm:highlight.js@11.11.1/lib/languages/php-template'
import plaintext from 'npm:highlight.js@11.11.1/lib/languages/plaintext'
import python from 'npm:highlight.js@11.11.1/lib/languages/python'
import pythonRepl from 'npm:highlight.js@11.11.1/lib/languages/python-repl'
import r from 'npm:highlight.js@11.11.1/lib/languages/r'
import rust from 'npm:highlight.js@11.11.1/lib/languages/rust'
import scss from 'npm:highlight.js@11.11.1/lib/languages/scss'
import shell from 'npm:highlight.js@11.11.1/lib/languages/shell'
import sql from 'npm:highlight.js@11.11.1/lib/languages/sql'
import swift from 'npm:highlight.js@11.11.1/lib/languages/swift'
import yaml from 'npm:highlight.js@11.11.1/lib/languages/yaml'
import typescript from 'npm:highlight.js@11.11.1/lib/languages/typescript'
import vbnet from 'npm:highlight.js@11.11.1/lib/languages/vbnet'
import wasm from 'npm:highlight.js@11.11.1/lib/languages/wasm'

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

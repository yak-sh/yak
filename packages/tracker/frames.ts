// Stack syntax is portable. Frame URLs lose query data before they leave this
// parser; only a host's resolver can establish whether a place is application code.

import type { Bundle } from '@yaks/graph'
import { comp, type Frame, str } from './model.ts'

let frame = (line: string): Frame | undefined => {
  let text = line.trim()
  let name: string | undefined
  if (text.startsWith('at ')) {
    text = text.slice(3).replace(/^async /, '')
    let call = text.match(/^(.*?) \((.*)\)$/)
    if (call) [name, text] = [call[1], call[2]]
  } else {
    let at = text.indexOf('@')
    if (at < 0) return
    name = text.slice(0, at)
    text = text.slice(at + 1)
  }
  let loc = text.match(/^(.*?):(\d+):(\d+)$/) ??
    text.match(/^(.*):(\d+)$/)
  if (!loc || !loc[1] || !Number(loc[2])) return
  return {
    file: loc[1].split(/[?#]/)[0],
    line: Number(loc[2]),
    ...loc[3] ? { column: Number(loc[3]) } : {},
    ...name ? { function: name } : {},
  }
}

export let stackFrames = (stack: string): Frame[] =>
  stack.slice(0, 128_000).split('\n').flatMap((line) => {
    let got = frame(line)
    return got ? [got] : []
  }).slice(0, 100)

export type Resolve = (frames: Frame[], commit: string) => Promise<Frame[]>
export let enrichFrames =
  (resolve?: Resolve) => async (row: Bundle): Promise<Bundle> => {
    let x = comp(row, 'exception')
    if (!row.exception) return row
    let frames = stackFrames(str(x.stack))
    // A browser reporter can provide frames when its runtime supplies no stack.
    if (!frames.length && Array.isArray(x.frames)) {
      frames = x.frames.slice(0, 100).flatMap((value) => {
        if (
          !value || typeof value != 'object' || typeof value.file != 'string'
        ) {
          return []
        }
        let { file, line, column, function: name } = value
        return [{
          file: file.split(/[?#]/)[0],
          ...typeof line == 'number' ? { line } : {},
          ...typeof column == 'number' ? { column } : {},
          ...typeof name == 'string' ? { function: name } : {},
        }]
      })
    }
    return {
      ...row,
      exception: {
        ...x,
        frames: resolve
          ? await resolve(frames, str(comp(row, 'error').commit))
          : frames.map((f) => ({ ...f, app: false })),
      },
    }
  }

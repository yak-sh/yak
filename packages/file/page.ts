/**
 * A machine's disks, as the browsing app draws them. For each volume: how full
 * it is and how fast that is changing; what fills it, a tree of directories
 * and files to open, each with its share and its change since a week before;
 * its largest files; and day by day. The file the graph keeps its pages in
 * says how much of it is free pages, from the store's own measurement
 * (`kept{file, free}`, @yaks/journal), and links to History.
 *
 * Everything is read from the rows the duty writes (./service.ts): opening the
 * page measures nothing. Which directories are open is the page's own state,
 * a `Disclosure{open}` on an entity derived from the volume and the path; a
 * directory holding a tenth of what is used opens by itself until then.
 *
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import {
  type Answer,
  type Bundle,
  type Io,
  mention,
  type Props,
  useNamed,
  type View,
} from '@yaks/inspect'
import { Head, Loading, Meter, Section, Table } from '@yaks/ui'
import { disclosed, disclosureAt, isOpen } from '@yaks/ux'
import { joined, size } from './mod.ts'
import {
  change,
  files,
  grew,
  type Line,
  lines,
  named,
  type Occupancy,
  occupancyIn,
  occupancyOf,
  opens,
  pagesFree,
  perDay,
  since,
  uncounted,
  within,
} from './occupancy.ts'

let { Body, Cell, Heading, Row } = Table

/** How many days of looks the trend reads. */
export let DAYS = 31

/** How many days before the latest look a change is read against. */
export let WEEK = 7

/** How many of the largest files are listed. */
export let FILES = 15

// What the trend reads of each look: its figures, never its paths.
let FIGURES = ['day', 'at', 'size', 'used', 'free', 'counted']
  .map((p) => `occupancy.${p}`).join(',')

type Volume = { machine: string; mount: string }
type Kept = { file?: string; free?: number }

let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let looks = (a?: Answer): Occupancy[] =>
  rows(a).map((b) => occupancyIn(b)).filter((o): o is Occupancy => !!o)
let share = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : ''

let waiting = (got: Answer | undefined, what: string) =>
  got?.error
    ? h(Section.Sub, { role: 'alert' }, got.error)
    : !got?.ready
    ? h(Loading, {}, `Loading ${what}…`)
    : null

// The rows under headings every table here has: a name, a bar, numbers.
let Ranked = (
  { heads, children }: { heads: string[]; children?: ComponentChildren },
) =>
  h(
    Table,
    { cols: [null, null, ...heads.map(() => 'num')] },
    h(
      Table.Head,
      {},
      h(
        Row,
        {},
        h(Heading, {}, ''),
        h(Heading, {}, ''),
        ...heads.map((k) => h(Heading, { key: k, mod: 'num' }, k)),
      ),
    ),
    h(Body, {}, children),
  )

// A row of bytes: its name, its share of `of` as a bar, its bytes and how
// they changed. A directory's row is pressed to open or close it, by the
// pointer or by Enter or Space where it has the keyboard.
let Measured = (
  { name, bytes, of, grown, mod, open, toggle }: {
    name: ComponentChildren
    bytes: number
    of: number
    grown: string
    mod?: string
    open?: boolean
    toggle?: () => void
  },
) =>
  h(
    Row,
    toggle
      ? {
        mod: [mod, 'picks'],
        tabIndex: 0,
        'aria-expanded': open,
        onClick: toggle,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key != 'Enter' && e.key != ' ') return
          e.preventDefault()
          toggle()
        },
      }
      : { mod },
    h(Cell, {}, name),
    h(Cell, {}, h(Meter, { value: bytes / (of || 1), width: 10 })),
    h(Cell, { mod: 'num' }, size(bytes)),
    h(Cell, { mod: 'num' }, grown),
  )

// Where a path is the file the graph keeps its pages in: how many of them
// are free, linking to History, which says more.
let freePages = (volume: string, path: string, kept?: Kept) => {
  let free = pagesFree(kept, volume, path)
  return free == null
    ? []
    : [' · ', h('a', { href: '/?@page=history' }, `${size(free)} free pages`)]
}

// Leading room a level deep in the tree, kept by both hosts.
let indent = (depth: number) => '  '.repeat(depth)

/** What fills a volume: every directory and file listed in a directory, the
 * open ones' own beneath them, and what each leaves too small to list. */
let Tree = (
  { io, eid, newer, older, kept }: {
    io: Io
    eid: string
    newer: Occupancy
    older?: Occupancy
    kept?: Kept
  },
) => {
  let state = (path: string): Bundle => {
    let at = disclosureAt(`${eid}|${path}`)
    return io.state(at) ?? { entity: { eid: at } }
  }
  let opened = (path: string, bytes: number) => {
    let s = state(path)
    return opens(s.Disclosure ? isOpen(s) : undefined, bytes, newer.used)
  }
  // A directory wears whether it is open; a file stands where that would.
  let name = (l: Line): ComponentChildren =>
    l.rest
      ? within(newer, l.path).listed.length ? 'the rest' : 'all of it'
      : l.open == null
      ? ['  ', named(l.path), ...freePages(eid, l.path, kept)]
      : `${l.open ? '▾' : '▸'} ${named(l.path)}`
  let missed = uncounted(newer)
  return h(
    Ranked,
    { heads: ['bytes', older ? `since ${older.day}` : 'change'] },
    lines(newer, opened).map((l) =>
      h(
        Measured,
        {
          key: `${l.path}${l.rest ? '…' : ''}`,
          mod: l.rest ? 'quiet' : undefined,
          name: [indent(l.depth), name(l)],
          bytes: l.bytes,
          of: newer.counted,
          grown: l.rest ? '' : change(grew(older, newer, l.path), !!older),
          open: l.open,
          toggle: l.open == null || l.rest
            ? undefined
            : () => io.set([disclosed(state(l.path), !l.open)]),
        },
      )
    ),
    missed
      ? h(Measured, {
        key: '…',
        mod: 'quiet',
        name: 'not counted: unreadable here, or the filesystem’s own',
        bytes: missed,
        of: newer.counted,
        grown: '',
      })
      : null,
  )
}

/** The largest files on a volume, by where they are on its machine. */
let Files = (
  { eid, mount, newer, older, kept }: {
    eid: string
    mount: string
    newer: Occupancy
    older?: Occupancy
    kept?: Kept
  },
) => {
  let largest = files(newer, FILES)
  return largest.length
    ? h(
      Section,
      {},
      h(
        Section.Title,
        {},
        'Largest files ',
        h(Section.Count, {}, String(largest.length)),
      ),
      h(
        Ranked,
        { heads: ['bytes', older ? `since ${older.day}` : 'change'] },
        largest.map(([path, bytes]) =>
          h(Measured, {
            key: path,
            name: [joined(mount, path), ...freePages(eid, path, kept)],
            bytes,
            of: newer.counted,
            grown: change(grew(older, newer, path), !!older),
          })
        ),
      ),
    )
    : null
}

/** Each day's look, newest first, beside the day before it. */
let Days = ({ days }: { days: Occupancy[] }) =>
  h(
    Section,
    {},
    h(
      Section.Title,
      {},
      'Day by day ',
      h(Section.Count, {}, String(days.length)),
    ),
    h(
      Ranked,
      { heads: ['used', 'free', 'change'] },
      days.map((o, i) => {
        let before = days[i + 1]
        return h(
          Row,
          { key: o.day },
          h(Cell, {}, o.day),
          h(Cell, {}, h(Meter, { value: o.used / (o.size || 1), width: 10 })),
          h(Cell, { mod: 'num' }, size(o.used)),
          h(Cell, { mod: 'num' }, size(o.free)),
          h(
            Cell,
            { mod: 'num' },
            before ? change(o.used - before.used, true) : '',
          ),
        )
      }),
    ),
  )

/** A volume: how full it is and how fast that is changing, what fills it,
 * its largest files, and day by day. */
let Disk = (
  { io, volume, named: onMachine, kept }: {
    io: Io
    volume: Bundle
    named?: boolean
    kept?: Kept
  },
): JSX.Element => {
  let eid = volume.entity.eid
  let { machine, mount } = volume.volume as Volume
  let trend = io.ask({
    days:
      `.occupancy.volume=${eid} .order=-occupancy.day .limit=${DAYS} .fields=${FIGURES}`,
  }).days
  let days = looks(trend)
  let [last] = days
  let then = since(days, WEEK)
  let full = io.ask(
    last
      ? {
        now: `.entity.eid=${occupancyOf(eid, last.day)} *`,
        ...then ? { then: `.entity.eid=${occupancyOf(eid, then.day)} *` } : {},
      }
      : {},
  )
  let newer = looks(full.now)[0]
  let older = looks(full.then)[0]
  let daily = then && perDay(then, last, (o) => o.used)
  return h(
    Section,
    { 'data-volume': eid },
    h(
      Section.Title,
      {},
      mount,
      onMachine ? [' on ', mention(io, machine)] : null,
    ),
    waiting(trend, 'its looks') ?? (!last
      ? h(
        Section.Sub,
        {},
        'Not looked at yet: the duty looks at the disks of the computer it runs on every hour.',
      )
      : [
        h(Meter, {
          key: 'fill',
          value: last.used / (last.size || 1),
          width: 40,
        }),
        h(
          Head.Facts,
          { key: 'facts' },
          `${size(last.used)} of ${size(last.size)} used (${
            share(last.used, last.size)
          })`,
          `${size(last.free)} free`,
          ...daily == null ? [] : [
            daily
              ? `${change(daily, true)} a day since ${then!.day}`
              : `unchanged since ${then!.day}`,
          ],
          `looked ${io.when(last.at)}`,
        ),
        !newer ? waiting(full.now, 'what fills it') : h(
          Section,
          { key: 'tree' },
          h(Section.Title, {}, 'What fills it'),
          h(Tree, { io, eid, newer, older, kept }),
        ),
        newer
          ? h(Files, { key: 'files', eid, mount, newer, older, kept })
          : null,
        h(Days, { key: 'days', days }),
      ]),
  )
}

// The store's own measurement of its file, where the graph keeps one.
let keptOf = (io: Io): Kept | undefined => {
  let got = io.ask(
    io.vocab.comp('kept')
      ? { kept: '.kept .order=-kept.day .limit=1 .fields=kept.file,kept.free' }
      : {},
  ).kept
  return rows(got)[0]?.kept as Kept | undefined
}

/** The disks of each machine a volume is known on, or of one. */
let Disks = (
  { io, volumes, named: onMachine }: {
    io: Io
    volumes?: Answer
    named?: boolean
  },
) => {
  let kept = keptOf(io)
  let all = rows(volumes).toSorted((a, b) =>
    String((a.volume as Volume).mount).localeCompare(
      String((b.volume as Volume).mount),
    )
  )
  useNamed(io, all.map((v) => (v.volume as Volume).machine))
  return waiting(volumes, 'the disks') ?? (all.length
    ? h(
      'div',
      {},
      all.map((v) =>
        h(Disk, { key: v.entity.eid, io, volume: v, named: onMachine, kept })
      ),
    )
    : h(
      Section.Sub,
      {},
      'No disk of it has been looked at. The duty looks at the disks of the computer it runs on.',
    ))
}

/** A machine's disks, or a volume's, under its head. */
export let DisksTab = ({ e, io, got }: Props): JSX.Element =>
  h(
    'div',
    { 'data-disks': e.entity.eid },
    io.show(e, 'Inspect.Head', {}),
    e.volume
      ? h(Disk, { io, volume: e, kept: keptOf(io) })
      : h(Disks, { io, volumes: got.volumes }),
  )

/** Every disk looked at, by machine: the page the sidebar offers. */
export let DisksPage = ({ io, got }: Props): JSX.Element =>
  h(
    'article',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, 'Disks'),
      h(
        Head.Sub,
        {},
        'How full each disk is and what fills it, from a look every hour by the computer it is on.',
      ),
    ),
    h(Disks, { io, volumes: got.volumes, named: true }),
  )

let machine = parse('.machine')
let volume = parse('.volume')

/** The views this package draws in the browsing app. */
export let inspectViews: View[] = [
  {
    view: 'Disks.Page',
    match: true,
    asks: () => ({ volumes: '.volume *' }),
    Render: DisksPage,
  },
  {
    view: 'Disks',
    match: machine,
    asks: (e) => ({ volumes: `.volume.machine=${e.entity.eid} *` }),
    Render: DisksTab,
  },
  { view: 'Disks', match: volume, Render: DisksTab },
]

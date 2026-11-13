// The trial commands a person types. `yak trial score` scores every context
// case the graph holds under a variant (./moment.ts); `yak trial load` reads a
// skill round's file into rows, `yak trial run` asks the writers and judges
// the round still owes (./run.ts) and `yak trial drop` removes a round
// (./round.ts). Each only hands the work the host's graph and what it read
// from this machine.
import type { CliCommand } from '@yaks/cli/host'

let round = {
  type: 'string',
  description: 'the round: the key it was loaded under, its id or its eid',
}

export let commands: CliCommand[] = [{
  name: 'trial_score',
  noun: 'trial',
  verb: 'score',
  description:
    "Score every miss in the graph under a persona (by default the one each session wore): writes trial{case, variant, asked, unasked, tokens} and prints the tally. With `arrive`, each case wears its own session's persona and the doors named add to it (@yaks/trial/arrive), and the rows are written under the persona `under` names.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant: { type: 'string', description: 'persona eid to score' },
      under: {
        type: 'string',
        description:
          'with arrive: the persona the rows are written under, which says what the doors add',
      },
      arrive: {
        type: 'array',
        items: {
          enum: [
            'beside',
            'related',
            'said',
            'open',
            'entry',
            'call',
            'reply',
            'theirs',
            'carried',
            'kept',
            'standing',
          ],
        },
        description:
          "doors that add to the persona: beside (the prompt recall beside the person's words), related (the related list beside a write's hits), said (the person's earlier words and answered decisions beside each thing the session wrote), open (what is open with the person at start), or the resources nearest the agent's own words once: entry (its erring entry), call (its last tool call), reply (its last reply or reasoning); or by link: theirs (the person's comments and answers of the day on what the window names), carried (after a compaction, the person's words to the session in the day before it and the tasks it filed quoting them), kept (carried, listing every memory the session saved in the day, whoever wrote the row), standing (at start, who the person is and the notices that came more than once in the day to the session or its parent)",
      },
      floor: {
        type: 'number',
        description:
          "with beside: the similarity a memory or decision must reach; with said: the similarity the person's words must reach (default the live ones); with entry, call or reply: the similarity a resource must reach (default none)",
      },
      few: {
        type: 'integer',
        minimum: 1,
        description:
          'with entry, call or reply: how many resources are listed (default 4)',
      },
    },
  },
  positional: ['variant'],
  run: async (args, host, context) => {
    let { cases, run } = await import('./moment.ts')
    let { tally } = await import('./mod.ts')
    if (!host.search) throw new Error('this graph has no search')
    let doors = Array.isArray(args.arrive) ? args.arrive.map(String) : []
    let variant: Parameters<typeof run>[4] = typeof args.variant == 'string'
      ? args.variant
      : undefined
    if (doors.length) {
      if (typeof args.under != 'string') {
        throw new Error(
          'arrive needs `under`: the persona to write the rows under',
        )
      }
      let arrive = await import('./arrive.ts')
      let said = host.config.person
      let person = said
        ? (await host.graph.address([said])).get(said) ?? said
        : undefined
      if (
        doors.some((d) =>
          ['beside', 'said', 'open', 'theirs', 'carried', 'kept', 'standing']
            .includes(d)
        ) && !person
      ) {
        throw new Error(
          'beside, said, open, theirs, carried, kept and standing need the config to name its person',
        )
      }
      let floor = typeof args.floor == 'number' ? args.floor : undefined
      let few = typeof args.few == 'number' ? args.few : undefined
      let drafted = (key: 'entry' | 'call' | 'reply') => () => {
        if (!host.meaning) {
          throw new Error('this graph has no search by meaning')
        }
        return arrive.drafted(host.graph, host.meaning, { key, few, floor })
      }
      let made = {
        beside: () =>
          arrive.beside(host.graph, {
            person: person!,
            meaning: host.meaning,
            floor,
          }),
        related: () => arrive.related(host.graph),
        said: () =>
          arrive.said(host.graph, {
            person: person!,
            meaning: host.meaning,
            floor,
          }),
        open: () => arrive.open(person!),
        entry: drafted('entry'),
        call: drafted('call'),
        reply: drafted('reply'),
        theirs: () => arrive.theirs(person!),
        carried: () => arrive.carried(person!),
        kept: () => arrive.carried(person!, { anyone: true }),
        standing: () => arrive.standing(person!),
      }
      let [as] = [...(await host.graph.address([args.under])).values()]
      variant = {
        as: as ?? args.under,
        arrivals: doors.map((d) => made[d as keyof typeof made]()),
      }
    }
    let all = await cases(host.storage)
    let rows = []
    for (let c of all) {
      let row = await run(host.storage, host.vocab, host.search, c, variant)
      if (row) rows.push(row)
    }
    if (rows.length) await host.graph.apply(rows)
    context.out(JSON.stringify(tally(rows, all), null, 2))
    return 0
  },
}, {
  name: 'trial_load',
  noun: 'trial',
  verb: 'load',
  description:
    'Load a skill round from its file (round.json): its variants, cases, attempts, pairs and guesses become rows. Loading the file again replaces them.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['file'],
    properties: {
      file: { type: 'string', description: 'the round file, JSON' },
    },
  },
  positional: ['file'],
  run: async (args, host, context) => {
    let { readTextFile } = await import('@yaks/file/io')
    let { load } = await import('./round.ts')
    let file = JSON.parse(await readTextFile(String(args.file)))
    let did = await load(host.graph, file)
    context.out(
      `${file.key}: ${did.rows} rows loaded as round ${did.round}` +
        (did.removed
          ? `, ${did.removed} pairs and guesses no longer in the file removed`
          : '') +
        (did.left
          ? `, ${did.left} attempts no longer in the file left in place`
          : '') +
        `\npage: /trial/${file.key}\ntally: yak trial tally ${file.key}`,
    )
    return 0
  },
}, {
  name: 'trial_run',
  noun: 'trial',
  verb: 'run',
  description:
    'Run what a skill round still owes: each attempt planned and not yet written is asked of a writer, then each guess planned of a judge, every one a session offered no tools, the persona arm selecting its persona. Says first what it will cost at list price by what earlier rows cost, writes each row as its session ends, and asks nothing more at the cap. Running it again asks only what never returned.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['round', 'cap'],
    properties: {
      round,
      cap: {
        type: 'number',
        minimum: 0,
        description:
          'the dollars it may spend at list price; 0 says the cost and asks nothing',
      },
      jobs: {
        type: 'integer',
        minimum: 1,
        description: 'how many calls go at once (default 6)',
      },
    },
  },
  positional: ['round'],
  run: async (args, host, context) => {
    let { find, gather, keyed } = await import('./round.ts')
    let { run } = await import('./run.ts')
    let eid = await find(host.graph, String(args.round))
    let ran = await run(host.graph, eid, {
      cap: Number(args.cap),
      jobs: args.jobs == null ? undefined : Number(args.jobs),
      label: await keyed(host.graph, await gather(host.graph, eid, true)),
      out: context.out,
      signal: host.stopping,
    })
    return ran.failed ? 1 : 0
  },
}, {
  name: 'trial_drop',
  noun: 'trial',
  verb: 'drop',
  description:
    'Delete a skill round: its attempts, pairs, taps and guesses, and each variant and case no other round uses.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['round'],
    properties: { round },
  },
  positional: ['round'],
  run: async (args, host, context) => {
    let { drop, find } = await import('./round.ts')
    let eid = await find(host.graph, String(args.round))
    context.out(`dropped ${await drop(host.graph, eid)} rows`)
    return 0
  },
}]

// The prompt on the page: what has been typed into the tab's graph and what
// it printed, a line being typed, and the story's steps, each typed in once
// as its section is reached. The visitor types into the same prompt.
import type { Yak } from "./yak.ts";
import { scriptOf } from "./site.ts";

/** A line the prompt shows: what was typed, what the agent called, or what
 * came back (`fault` when it failed). */
export type Line = { kind: "in" | "agent" | "out" | "fault"; text: string };

/** How long the prompt waits between typed characters; none in a test. */
export type Pace = { key: number; pause: number };

export type Term = ReturnType<typeof term>;

export let term = (yak: Yak, pace: Pace = { key: 0, pause: 0 }) => {
  let lines: Line[] = [];
  let typing = "";
  let busy = false;
  let listeners = new Set<() => void>();
  let told = () => listeners.forEach((l) => l());
  let wait = (ms: number) =>
    ms ? new Promise((ok) => setTimeout(ok, ms)) : Promise.resolve();
  let chain = Promise.resolve();
  let queue = (work: () => Promise<void>) =>
    chain = chain.then(async () => {
      busy = true;
      told();
      try {
        await work();
      } finally {
        busy = false;
        told();
      }
    });

  let printed = (code: number, out: string[]) => {
    let kind: Line["kind"] = code ? "fault" : "out";
    lines.push(...out.map((text) => ({ kind, text })));
  };
  let submit = async (line: string) => {
    lines.push({ kind: "in", text: line });
    told();
    let { code, out } = await yak.run(line);
    printed(code, out);
    await yak.settled();
    told();
  };
  let type = async (line: string) => {
    for (let i = 1; i <= line.length; i++) {
      typing = line.slice(0, i);
      told();
      await wait(pace.key);
    }
    await wait(pace.pause);
    typing = "";
    await submit(line);
  };
  let ask = async (tool: string, args: Record<string, unknown>) => {
    lines.push({ kind: "agent", text: `${tool} ${JSON.stringify(args)}` });
    told();
    let { code, out } = await yak.ask(tool, args);
    printed(code, out);
    await yak.settled();
    told();
  };

  // The steps reached so far run once each, in order, however fast the page
  // is scrolled past them.
  let ran = 0;
  let query: string | undefined;
  return {
    lines: () => lines,
    typing: () => typing,
    busy: () => busy,
    listen: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** Type a line the visitor wrote and run it. */
    enter: (line: string) => queue(() => submit(line)),
    /** Run every step up to `n` (counting from 1) that has not run, typing
     * each step's commands and making its agent's calls. */
    reach: (bodies: string[], n: number) => {
      while (ran < Math.min(n, bodies.length)) {
        let script = scriptOf(bodies[ran++]);
        let { sh, mcp } = script;
        if (script.query) {
          query = script.query;
          told();
        }
        queue(async () => {
          for (let line of sh) await type(line);
          for (let { tool, args } of mcp) await ask(tool, args);
        });
      }
      return chain;
    },
    /** The drawing's query the furthest step reached asks for, if any. */
    query: () => query,
    /** Settles once everything queued has run. */
    idle: () => chain,
  };
};

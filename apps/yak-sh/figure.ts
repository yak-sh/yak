// What the page's drawing shows: the query it draws, and what the last write
// made and which phases of apply() it ran.
import type { Yak } from "./yak.ts";

/** The page's drawing: the query it shows, and the last write it saw. */
export type Figure = ReturnType<typeof figure>;

/** What the story's drawing shows unless a step or the visitor asks for more. */
export let STORY = ".task|.comment|.edge|.person *";

export let figure = (yak: Yak) => {
  let query = STORY;
  let last: { eid?: string; phases: string[] } = { phases: [] };
  let listeners = new Set<() => void>();
  let told = () => listeners.forEach((l) => l());
  // A write's subject is the entity it made or changed that is not the call
  // that asked for it.
  yak.listen(({ bundles, phases }) => {
    let made = bundles.filter((b) => !b.call && !b.result && !b.tool);
    if (!made.length) return;
    let subject = made.find((b) => !b.edge) ?? made[0];
    last = { eid: subject.entity.eid, phases: [...phases, "audit"] };
    told();
  });
  return {
    query: () => query,
    ask: (q: string) => {
      query = q;
      told();
    },
    last: () => last,
    listen: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
};

// The Operator's recall ranks by meaning over its store's own vectors
// (operator-store.ts `Vectors`), so a memory worded differently from the
// person's message still reaches the turn beside it (T-1674), and only for
// someone who writes in the space.
import { equal, test } from "@yaks/testing";
import type { Embedder } from "@yaks/embedding";
import type { Request } from "@yaks/model";
import { platform } from "./directory-rows-probe.ts";
import { directoryOf } from "./directory.ts";
import { operatorModel, operatorService } from "./operator-testing.ts";
import { receive } from "./operator-channels.ts";
import { type OperatorStore, operatorStore } from "./operator-store.ts";
import { operatorVectors } from "./operator-vectors.ts";
import { embeds, modelPage } from "./testing.ts";
import { durable } from "../../packages/durable-object/testing.ts";

// An embedder that puts the memory .62 from the person's message, as near as
// yaks.app's model puts a paraphrase: past its floor for memories (embedding.ts
// `FLOORS`), short of the floor @yaks/memory measured on the box's model.
let meaning: Embedder = {
  model: "subject-3",
  embed: (text) =>
    new Float32Array(
      /veggies|kelp/.test(text) && !/rainwater/.test(text)
        ? [.62, Math.sqrt(1 - .62 ** 2), 0]
        : /rainwater/.test(text)
        ? [0, 1, 0]
        : /tomatoes/.test(text)
        ? [1, 0, 0]
        : [0, 0, 1],
    ),
};

let { env } = platform("operator-meaning");
let dir = directoryOf(env.STORE);
let person = crypto.randomUUID(), eid = crypto.randomUUID();
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: "Ada" } },
    { entity: { eid }, space: { slug: "ada", store: "ada" } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: "owner" },
    },
  ],
}, { "x-yak-person": person, "x-yak-role": "owner" });
let asked: Request[] = [];
let store = await operatorStore(durable(), {}, {}, {
  model: () => meaning,
  arm: () => Promise.resolve(),
});
let service = operatorService(
  env,
  { person, role: "owner" as const, space: eid },
  operatorModel((req) => {
    asked.push(req);
    let last = req.items.at(-1);
    let save = last?.kind == "user" &&
      last.text.includes("Remember these facts.");
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: save
        ? [
          { said: PERSONAL },
          { said: SHARED, shared: true },
        ].map((args) => ({
          kind: "call" as const,
          name: "memory_save",
          id: crypto.randomUUID(),
          args: JSON.stringify(args),
        }))
        : [{ kind: "assistant", text: "Yes." }],
      cost: 0.001,
    });
  }),
  store,
);
env.BUILDER = service.binding;
let KEPT = "Ada waters her tomatoes every morning before work";
let PRIVATE = "Bea uses rainwater on her veggies";
let PERSONAL = "Bea fertilizes her tomatoes with kelp";
let SHARED = "The space’s garden grows tomatoes behind the library";
let bea = crypto.randomUUID(), beas = crypto.randomUUID();
await dir.apply({
  entities: [
    { entity: { eid: bea }, person: {}, doc: { title: "Bea" } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: bea, space: eid, role: "editor" },
    },
  ],
}, { "x-yak-person": person, "x-yak-role": "owner" });
let [, { entity: memory }] = await store.g.apply([
  { entity: { eid: person }, person: {} },
  {
    entity: { eid: crypto.randomUUID() },
    memory: {},
    doc: { title: KEPT, body: KEPT },
    $actor: { by: person },
  },
  { entity: { eid: bea }, person: {} },
  {
    entity: { eid: beas },
    session: {},
    operator_session: { person: bea, space: eid },
  },
  // The private memories are closer than Ada's and would fill the ranking.
  ...Array.from({ length: 6 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session: beas },
    memory: {},
    content: { body: `${PRIVATE} (${i + 1})` },
    $actor: { by: bea },
  })),
], { trusted: true });
let chat = async (person: string, text: string) => {
  await receive(store, { space: eid, person, channel: "chat" }, text);
  await service.drain();
};
await chat(bea, "Remember these facts.");
await store.vectors!.work();

let question = "How often should my backyard veggies get a drink?";
let prompt = ({ items, turnContext }: Request) =>
  JSON.stringify([...items, ...turnContext ?? []]);
await chat(person, question);
let turn = prompt(asked.at(-1)!);
await chat(bea, question);
let ownRecall = (await store.g.read('.prompt.source="operator:earlier"&*'))
  .filter((row) => JSON.stringify(row.content).includes(PERSONAL));
// Someone outside the space, replying to a letter the Operator sent them.
await receive(
  store,
  {
    space: eid,
    person: crypto.randomUUID(),
    channel: "letter",
    address: "cy@example.com",
  },
  "How often should my backyard veggies get a drink?",
);
await service.drain();
let replied = prompt(asked.at(-1)!);

test("a memory worded unlike the message reaches its turn by meaning", () => {
  equal(turn.includes("Nearest memories and decisions"), true);
  equal(turn.includes(KEPT), true);
});
test("auto-recall leaves out another person's private memories", () => {
  equal(turn.includes(PRIVATE), false);
  equal(turn.includes(PERSONAL), false);
  equal(turn.includes(SHARED), true);
});
test("the save records its audience and only the owner auto-recalls it", async () => {
  let rows = await store.g.read(".memory&.operator_memory&*");
  let saved = (text: string) =>
    rows.find((b) => JSON.stringify(b.doc).includes(text));
  equal(saved(PERSONAL)?.owner, { person: bea });
  equal(saved(SHARED)?.operator_memory, {});
  equal(ownRecall.length, 1);
});
test("someone outside the space is brought none of its memories", () => {
  equal(replied.includes("cy@example.com"), true);
  equal(replied.includes("Nearest memories and decisions"), false);
});
test("its vectors are kept in the Operator store", async () => {
  equal(store.vectors!.owes(), false);
  equal(
    (await store.meaning!("tomatoes", { limit: 2 })).map((hit) => hit.entity)
      .includes(memory.eid),
    true,
  );
});

// The lender the Builder gives its store (operator-vectors.ts), over Workers
// AI: a store no session names a space for has nobody to bill, so it lends no
// embedder and its drains wait without failing, until a session names one.
env.AI = embeds({} as never) as unknown as typeof env.AI;
env.MODEL_FETCH = () => Promise.resolve(modelPage(0.01, 0));
let lent = Promise.withResolvers<void>();
let alone: OperatorStore = await operatorStore(
  durable(),
  {},
  {},
  operatorVectors(env, {
    space: () => alone,
    arm: () => Promise.resolve(),
    ready: () => {
      alone.vectors?.run();
      lent.resolve();
    },
  }),
);
await alone.g.apply([{
  entity: { eid: crypto.randomUUID() },
  memory: {},
  doc: { title: KEPT },
}], { trusted: true });
await alone.vectors!.work();
let waited = alone.vectors!.owes();
// A session arrives with the words it was started on.
let started = crypto.randomUUID();
await alone.g.apply([
  {
    entity: { eid: started },
    operator_session: { space: eid, person },
    session: { id: started },
  },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session: started },
    content: { body: "Hello there." },
  },
], { trusted: true });
// The space is learned by a read, and the drain then runs: wait on each, not
// on a count of ticks.
await lent.promise;
for (let w; (w = alone.vectors!.work());) await w;

test("a store no session names a space for waits to embed, then drains", () => {
  equal([waited, alone.vectors!.owes()], [true, false]);
});

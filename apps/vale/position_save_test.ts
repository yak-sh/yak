// Hero movement stays live between saves; only players keep a snapshot.
import { equal, test } from "@yaks/testing";
import { FakeTime } from "@std/testing/time";
import { type Bundle, graph } from "@yaks/graph";
import { loadVocab } from "@yaks/vocab";
import { ram } from "@yaks/ram";
import { subscriptions } from "../../packages/api/subs.ts";
import core from "../../packages/kernel/vocab.json" with { type: "json" };
import words from "./vocab.json" with { type: "json" };
import { comp } from "./bundle.ts";

test("hero saves use position age, settle after disconnect and never save wildlife", async () => {
  using clock = new FakeTime();
  let vocab = loadVocab([words, core]);
  let g = graph({ storage: ram(vocab), vocab });
  await g.apply([{ entity: { eid: "hero" }, player: {} }]);
  let subs = subscriptions(g), sink = () => {};
  let at = Date.now();
  let move = (eid: string, x: number) => [{
    entity: { eid },
    position: { level: "mossvale", x, y: 5, z: 128, at: Date.now() },
  }];
  let stored = () => comp((g.get(["hero"]) as Bundle[])[0], "position");
  await subs.relay(sink, move("hero", 128));
  equal(stored().x, 128);
  await clock.tickAsync(10_000);
  await subs.relay(sink, move("hero", 135));
  await subs.relay(sink, move("wildlife", 130));
  equal(stored().x, 128);
  // Unrelated hero writes must not defer its pending position save.
  await g.apply([{ entity: { eid: "hero" }, damageable: { on: true } }]);
  let connected = ".player .position.level=mossvale";
  equal((await subs.read(connected)).length, 1);
  equal(comp((await subs.read(connected))[0], "position").x, 135);
  await subs.drop(sink);
  equal((await subs.read(connected)).length, 0);
  await clock.tickAsync(19_999);
  equal(stored().x, 128);
  await clock.tickAsync(1);
  equal([stored().x, stored().at], [135, at + 10_000]);
  equal(comp((g.get(["wildlife"]) as Bundle[])[0], "position"), {});
});

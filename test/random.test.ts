import { createScheduler } from "../src";
import { schedulerOpts } from "./conf";

import { v4 as uuid } from "uuid";

function generateData(n: number) {
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(uuid());
  }
  return result;
}

function randomInt(a: number, b: number) {
  return a + Math.floor(Math.random() * (b - a));
}

test("basic", (done) => {
  const ss = [];
  const n = 1000;
  const randomData = generateData(n);
  const tid = "simple2";

  const received: string[] = [];
  for (let i = 0; i < 20; i++) {
    const s = createScheduler(schedulerOpts);
    s.bind(tid, (data) => {
      received.push(data!);
      if (received.length === n) {
        expect(randomData.sort()).toEqual(received.sort());
        done();
      }
      return true;
    });
    s.start();
    ss.push(s);
  }
  for (const data of randomData) {
    ss[0].push(tid, { data });
  }
});

test.only("with delay", (done) => {
  const ss = [];
  const n = 10000;
  const randomData = generateData(n);
  const tid = "simple2";

  const received: string[] = [];
  for (let i = 0; i < 20; i++) {
    const s = createScheduler(schedulerOpts);
    s.bind(tid, (data) => {
      received.push(data!);
      if (received.length === n) {
        expect(randomData.sort()).toEqual(received.sort());
        done();
      }
      return true;
    });
    s.start();
    ss.push(s);
  }
  for (const data of randomData) {
    ss[0].push(tid, { data, delay: randomInt(500, 1000) });
  }
});

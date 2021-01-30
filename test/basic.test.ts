import { createScheduler } from "../src";
import { sleep } from "../src/sleep";
import { schedulerOpts } from "./conf";

test("start scheduler", () => {
  const s = createScheduler(schedulerOpts);
  s.start();
  s.stop();
  s.clear();
});

describe("one producer one consumer", () => {
  test("basic", (done) => {
    const s = createScheduler(schedulerOpts);
    const tid = "simple1";
    s.bind(tid, () => {
      done();
      s.stop();
      return true;
    });
    s.start();
    s.push(tid, {});
  });

  test("with data", (done) => {
    const s = createScheduler(schedulerOpts);
    const tid = "simple2";
    const str = "whatever";
    s.bind(tid, (data) => {
      try {
        expect(data).toEqual(str);
        s.stop();
        done();
      } catch (err) {
        s.stop();
        done(err);
      }
      return true;
    });
    s.start();
    s.push(tid, { data: str });
  });

  test("with delay", (done) => {
    const s = createScheduler(schedulerOpts);
    const tid = "simple3";
    const delayTime = 1000;
    const startTime = Date.now();
    s.bind(tid, () => {
      const duration = Date.now() - startTime;
      try {
        expect(duration).toBeGreaterThan(delayTime);
        s.stop();
        done();
      } catch (err) {
        s.stop();
        done(err);
      }
      return true;
    });
    s.start();
    s.push(tid, { delay: delayTime });
  });

  test("test timeout retry", (done) => {
    const s = createScheduler(schedulerOpts);
    const tid = "simple4";
    let called = 0;
    s.bind(tid, () => {
      if (called === 0) {
        called += 1;
        return false;
      } else {
        s.stop();
        done();
        return true;
      }
    });
    s.start();
    s.push(tid, { retry: true, retryTimeout: 200 });
  });
});

describe("schedule test", () => {
  test("one schedule", async () => {
    const taskId = "schedule1";
    let count = 0;
    const scheduler = createScheduler(schedulerOpts);
    scheduler.bind(taskId, () => {
      count += 1;
      return true;
    });
    scheduler.register(taskId, { cronExpr: "*/1 * * * * *" });
    scheduler.start();
    await sleep(10000);
    scheduler.stop();
    expect(count).toBeGreaterThanOrEqual(9);
  }, 20000);
  test("multiple scheduler", async () => {
    const taskId = "schedule2";
    const schedulers = [];
    let count = 0;
    for (let i = 0; i < 10; i++) {
      const scheduler = createScheduler(schedulerOpts);
      scheduler.bind(taskId, () => {
        count += 1;
        return true;
      });
      scheduler.register(taskId, { cronExpr: "*/1 * * * * *" });
      schedulers.push(scheduler);
    }
    for (const s of schedulers) {
      s.start();
    }
    await sleep(10000);
    for (const s of schedulers) {
      s.start();
    }
    expect(count).toBeGreaterThan(9);
  }, 20000);
});

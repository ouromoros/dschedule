import { createScheduler } from "../src";
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
    const delayTime = 200;
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
      done();
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

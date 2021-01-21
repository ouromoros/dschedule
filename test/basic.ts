import { createScheduler } from "../src";
import { schedulerOpts } from "./conf";

test("start scheduler", () => {
  const s = createScheduler(schedulerOpts);
  s.start();
  s.stop();
});

describe("one producer one consumer", () => {
  const s = createScheduler(schedulerOpts);

  afterEach(() => {
    s.stop();
    s.clear();
  });

  test("basic", (done) => {
    const tid = "simple";
    s.bind(tid, () => {
      done();
      return true;
    });
    s.start();
    s.push(tid, {});
  });

  test("with data", (done) => {
    const tid = "simple";
    const str = "whatever";
    s.bind(tid, (data) => {
      try {
        expect(data).toEqual(str);
        done();
      } catch (err) {
        done(err);
      }
      return true;
    });
    s.start();
    s.push(tid, { data: str });
  });

  test("with delay", (done) => {
    const tid = "simple";
    const delayTime = 1000;
    const startTime = Date.now();
    s.bind(tid, () => {
      const duration = Date.now() - startTime;
      try {
        expect(duration).toBeGreaterThan(delayTime);
        done();
      } catch (err) {
        done(err);
      }
      done();
      return true;
    });
    s.start();
    s.push(tid, { delay: delayTime });
  });

  test("test timeout retry", (done) => {
    const tid = "simple";
    let called = 0;
    s.bind(tid, () => {
      if (called === 0) {
        called += 1;
        return false;
      } else {
        done();
        return true;
      }
    });
    s.start();
    s.push(tid, { retry: true, retryTimeout: 1000 });
  });
});

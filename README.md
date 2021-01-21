# dschedule

Client-side job scheduler for distributed application

## Introduction

`dschedule` is a client-side library for scheduling tasks. The tasks can be configured to be run with at-least-once or at-most-once semantics.

Distributed applications can use `dschedule` to easily schedule jobs with a variety of options, including automatic failover, cronjob and delayed job.

`dschedule` uses Redis as its backend and is as reliable as the Redis backend is. In case Redis instance crashes, how many pending/delayed tasks `dschedule` can recover depends on Redis' persistence config.

## Example

### Basic Usage

```js
const scheduler = createScheduler({
    storageType: "redis",
    storageConfig: {
        host: "127.0.0.1",
        port: 5379,
        password: "dummy",
    }
});
scheduler.bind("taskA", () => {
    console.log("task");
});
scheduler.register("taskA", {
    cronExpr: "*/10 * * * * *"
});
scheduler.start();
```

The scheduler takes care of scheduling tasks one at a time and distribute tasks to multiple machines. When multiple instances of schedulers with the same config is running, the registered task will be fired only once and run only once (actually it's *at-most-once* in the case of unrecoverage error). In a distributed environment, a fault-tolerant cron scheuduler is achieved via running multiple application instances with the same config.

The scheduler will only be listening for/scheduling tasks and run them with the callback provided *after* `scheduler.run()` is called. It can also be stopped using `scheduler.stop()` method.

### Manually Push Task

It is also possible to manually push a task to the scheduler. Notice that a manually pushed task will only share a common `taskId` with registered tasks (if such task exist).

```js
scheduler.push("taskA");
```

A job can be set to retry automatically in case an unrecoverable error (machine crash/network failure) occurs. In corner cases duplicate jobs can be executed, so it is the application's responsibility to make the job idempotent.

```js
scheduler.push("taskA", { retry: true, retryTimeout: 5000 });
```

A job can also carry data or be delayed. The data will be passed to the registered handler function.

```js
scheduler.register("taskB", (data) => {
    console.log("received ", data);
});
...
scheduler.push("taskB", { data: "im data", delay: 5000 });
```

## More

- [ ] Write examples
- [ ] Write tests
- [ ] Write Architecture
- [ ] Benchmark

## More distantly

- [ ] Redis Cluster support
- [ ] Add support for Redis stream
- [ ] More powerful features

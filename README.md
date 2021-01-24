# schedule-mq

Persistent, reliable, robust client-side job scheduler for distributed application.

## Introduction

`schedule-mq` is a persistent, reliable robust client-side library for scheduling tasks.

Distributed applications can use `schedule-mq` to easily add, schedule and execute jobs with a variety of options, including automatic failover, cronjob and delayed execution. It supports robust automatic retry, and offers persistence through machine crashes, network losses and everything that can go wrong.

`schedule-mq` uses Redis as its backend and is as reliable as the Redis server is. In case the Redis instance crashes, how much state (pending/delayed/retried tasks) `schedule-mq` can recover depends on the underlying Redis server's persistence config and reliability. For full consistence guarantee, it is suggested to set the following in Redis config:

```
appendonly yes
appendfsync always // slow performance
```

Note that the above config would induce a huge performance penalty on Redis as a whole. So for the less strict task scheduling requirements, it is suggested to just set `appendfsync` to `everysec`, which would allow loss of the newest data (in one or two senconds) when Redis server crashes, but can recover most data on restart.

## Concepts

### Scheduler

Scheduler is the main entry for everything the library has to offer. It interacts with the Redis database and manage registered and binded tasks. Every scheduler instance works independently and cooperates through the underlying Redis database (if they have the same Redis config).

Typically an application will have multiple instances of schedulers, with possibly different configs and run on possibly different machines (even in possibly different languages). They connect to the same Redis server and thus work together through it.

### Task

A task is uniquely identified by its `taskId`. When you `bind` a `taskId`, you define what work should be done when the corresponding task is scheduled. When you `register` (cron-like) or `push` (one-time) a task, you can specify additional options like `retry`, `retryTimeout` and `delay` to determine how the task should be scheduled. When the scheduler invokes a handler to a task, it only knows that an event named `taskId` is scheduled and maybe with additional `data`, and it doesn't care how they were configured (delayed or retried).

## Example

### Basic Usage

First create a scheduler instance to get started.


```js
const scheduler = createScheduler({
    redisConfig: {
        host: "127.0.0.1",
        port: 5379,
        password: "dummy", // optional
        db: 0, // optional
    },
    redisPrefix: "_my_prefix:", // defaults to "_schedule_mq:"
    pollInterval: 2000,  // defaults to 1000, generally needn't be changed
});

scheduler.bind("taskA", () => {
    console.log("task");
    return true;
});
scheduler.register("taskA", {
    cronExpr: "*/10 * * * * *"
});

scheduler.start();
```
```

`bind()` and `register()` are used to configure the scheduler before `start()` is called. After `start()` the scheduler would be running, and you can not alter the configs any more unless `stop()`ed.

Call `bind()` to bind a handler function to the specific `taskId`. The scheduler will be listening for binded `taskId`s and execute them with the corresponding handlers after `start()` is called.

```js
scheduler.bind("taskA", () => {
    console.log("task");
    return true;
});
scheduler.register("taskA", {
    cronExpr: "*/10 * * * * *"
});
scheduler.start();
```

The scheduler takes care of scheduling registered tasks one at a time and distribute tasks to multiple machines. When multiple instances of schedulers with the same config (same jobId and cronExpr) is running, the registerd task will be fired only once and run only once (actually it's *at-most-once* in the case of unrecoverage error). In a distributed environment, a fault-tolerant cron scheuduler is achieved via running multiple application instances with the same config.

```
// Even if we have two schedulers with the same taskA config, taskA will be executed only once every 10 seconds
scheduler.register("taskA", {
    cronExpr: "*/10 * * * * *"
});
scheduler.start();

scheduler2.register("taskA", {
    cronExpr: "*/10 * * * * *"
});
scheduler2.start();
```

The scheduler will only be listening for/scheduling tasks and run them with the callback provided *after* `scheduler.run()` is called. It can also be stopped using `scheduler.stop()` method.

A registered task can also be configured to be automatically retried.

```js
scheduler.register("taskA", {
    cronExpr: "* */10 * * * *",
    retry: true,
    retryTimeout: 10000,
});
```

#### Manually Push Task

It is also possible to manually push a task to the scheduler. Notice that a manually pushed task will only share a common `taskId` with registered tasks (if such task exist) and will be handled by the same binded handlers.

```js
scheduler.push("taskA");
```

A task can be set to retry automatically in case an unrecoverable error (machine crash/network failure) occurs. If the machine crashes or the handler function returns `false`, the task will be automatically issued again after `retryTimeout`. In corner cases duplicate tasks can be executed, so it is the application's responsibility to make the job idempotent.

```js
scheduler.push("taskA", { retry: true, retryTimeout: 5000 });
```

A task can also carry data or be delayed. The data will be passed to the binded handler function.

```js
scheduler.bind("taskB", (data) => {
    console.log("received ", data);
    return true;
});
...
scheduler.push("taskB", { data: "im data", delay: 5000 });
```

## More

- [x] Write examples
- [x] Write tests
- [ ] More Complex tests
- [ ] Dynamic config?

### More distantly

- [ ] Write Architecture
- [ ] Benchmark
- [ ] Redis Cluster support
- [ ] Add support for Redis stream
- [ ] More powerful features

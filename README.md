# schedule-mq

Client-side job scheduler for distributed application

## Introduction

`schedule-mq` is a robust client-side library for scheduling tasks.

Distributed applications can use `schedule-mq` to easily add, schedule and execute jobs with a variety of options, including automatic failover, cronjob and delayed execution. It supports robust automatic retry, and offers persistence through machine crashes, network losses and everything tha can go wrong.

`schedule-mq` uses Redis as its backend and is as reliable as the Redis server is. In case the Redis instance crashes, how much state (pending/delayed/retried tasks) `schedule-mq` can recover depends on Redis' persistence config and reliability.

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

The scheduler takes care of scheduling tasks one at a time and distribute tasks to multiple machines. When multiple instances of schedulers with the same config (same jobId and cronExpr) is running, the registerd task will be fired only once and run only once (actually it's *at-most-once* in the case of unrecoverage error). In a distributed environment, a fault-tolerant cron scheuduler is achieved via running multiple application instances with the same config.

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

A job can also carry data or be delayed. The data will be passed to the binded handler function.

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
- [ ] Write Architecture
- [ ] Benchmark

## More distantly

- [ ] Redis Cluster support
- [ ] Add support for Redis stream
- [ ] More powerful features

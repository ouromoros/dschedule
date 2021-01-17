## dschedule

Client-side job scheduler for distributed application

### example

#### Basic Usage

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

#### Manually Fire Task

After calling `start()`, the scheduler will be listening for tasks and run them with the callback provided.
```js
scheduler.bind("taskA", () => {
    console.log("task");
});
scheduler.start();
```

#### Fire a task with additional data

#### Fire a task with delay

## More

- [ ] Write examples
- [ ] Write tests
- [ ] Write Architecture
- [ ] Benchmark

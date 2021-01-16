import { parseExpression } from "cron-parser";
import ioredis from "ioredis";
import { v4 as uuid } from "uuid";
import { RedisBroker } from "./redis_impl";
import { Execution, parseExec } from "./struct";

interface Handler {
  (data?: string): boolean | Promise<boolean>;
}

interface SchedulerOptions {
  storageType: "redis";
  storageConfig: ioredis.RedisOptions;
}

interface ScheduleOptions {
  cron?: boolean;
  cronExpr?: string;

  retry?: boolean;
  retryTimeout?: number;
}

interface FireOptions {
  data?: string;

  delay?: number;

  retry?: boolean;
  retryTimeout?: number;
}

enum Status {
  RUNNING,
  STOPPED,
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Scheduler {
  private registerMap: Record<string, ScheduleOptions>;
  private bindMap: Record<string, Handler>;
  private status: Status;
  private logger: Console;
  private broker: RedisBroker;

  constructor(redisConfig: ioredis.RedisOptions) {
    this.registerMap = {};
    this.bindMap = {};
    this.status = Status.STOPPED;
    this.logger = console;

    this.broker = new RedisBroker(redisConfig);
  }

  start() {
    this.status = Status.RUNNING;
    this.startSchedules();

    this.checkScheduledTasks();
    this.checkBindTasks();
  }

  stop() {
    this.status = Status.STOPPED;
  }

  private async checkScheduledTasks() {
    while (this.status === Status.RUNNING) {
      const exe = await this.broker.tpop();
      const execution = parseExec(exe);
      this.pushExecution(execution);
    }
  }

  private getBindTaskQueues() {
    return Object.keys(this.bindMap);
  }

  private async checkBindTasks() {
    while (this.status === Status.RUNNING) {
      const queues = this.getBindTaskQueues();
      const exe = await this.broker.rpop(queues);
      if (!exe) continue;
      const exec = parseExec(exe);
      this.doExec(exec);
    }
  }

  private async doExec(exec: Execution) {
    const handler = this.bindMap[exec.taskId];
    try {
      let success = handler(exec.data);
      if (success instanceof Promise) {
        success = await success;
      }
      if (!success) {
        throw new Error("task failed");
      }
      if (exec.retry) {
        this.broker.clearTimeout(exec.execId);
      }
    } catch (e) {
      this.logger.error(e);
    }
  }

  register(taskId: string, options: ScheduleOptions = {}) {
    this.registerMap[taskId] = options;
  }

  bind(taskId: string, handler: Handler) {
    this.bindMap[taskId] = handler;
  }

  private pushExecution(execution: Execution) {
    this.broker.rpush(execution);
  }

  private pushDelayed(exec: Execution, delay: number) {
    const timeStamp = Date.now() + delay;
    this.broker.tpush(timeStamp, exec);
  }

  fire(taskId: string, opts: FireOptions) {
    const exec = {
      taskId,
      execId: uuid(),
      data: opts.data,
      retry: opts.retry,
      retryTimeout: opts.retryTimeout,
    };
    if (!opts.delay) {
      this.pushExecution(exec);
    } else {
      this.pushDelayed(exec, opts.delay);
    }
  }

  private getScheduleTasks() {
    const result = [];
    // eslint-disable-next-line guard-for-in
    for (const taskId in this.registerMap) {
      const options = this.registerMap[taskId];
      if (options.cron) {
        result.push({ taskId, options });
      }
    }
    return result;
  }

  private async startSchedule(taskId: string, options: ScheduleOptions) {
    const cron = parseExpression(options.cronExpr!);
    let nextTime = cron.next().getTime();
    while (this.status === Status.RUNNING && nextTime) {
      await sleep(nextTime - Date.now());
      // TODO: Change to Atomic operation
      const success = await this.broker.laquire(
        `sched:${taskId}:${nextTime}`,
        10000
      );
      if (success) {
        this.fire(taskId, {});
      }
      nextTime = cron.next().getTime();
    }
  }

  private startSchedules() {
    const tasks = this.getScheduleTasks();
    for (const { taskId, options } of tasks) {
      this.startSchedule(taskId, options);
    }
  }
}

export function createScheduler(opts: SchedulerOptions) {
  return new Scheduler(opts.storageConfig);
}

/* eslint-disable @typescript-eslint/ban-ts-comment */
import ioredis from "ioredis";
import { encodeExec, Execution } from "./struct";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RedisBroker {
  private client: ioredis.Redis;
  private bClientPool: ioredis.Redis[];
  private clientOpts: ioredis.RedisOptions;
  private prefix: string;
  private timeoutQueue: string;
  private pollInterval: number;

  constructor(clientOpts: ioredis.RedisOptions) {
    this.clientOpts = clientOpts;
    this.bClientPool = [];
    this.prefix = "_rescheduler";
    this.timeoutQueue = `${this.prefix}:tq`;
    this.pollInterval = 1000;
    this.client = new ioredis({
      ...clientOpts,
      keyPrefix: this.prefix,
    });

    /**
     * KEYS[0]: execId
     * KEYS[1]: timeoutQueue
     * ARGV[0]: currentTimestamp
     */
    const maybeAddTimeoutScript = `
    local val = redis.call('GET, KEYS[0])
    local exec = cjson.decode(val)
    if val.retry ~= nil and val.retryTimeout ~= nil then
      redis.call('ZADD', KEYS[1], val, tonumber(ARGV[1]) + exec.retryTimeout)
    end
    `;
    /**
     * KEYS[0]: lockName
     * KEYS[1]: timeoutQueue
     * KEYS[2]: execId
     * ARGV[0]: lockTimeout
     * ARGV[1]: execTimeoutStamp
     * ARGV[2]: exec
     */
    const lockAndAddTimeoutScript = `
    local val = redis.call('SETNX', KEYS[0])
    if val == 0 then
      return 0
    redis.call('EXPIRE', KEYS[0], ARGV[0])
    redis.call('ZADD)
    `;
    this.client.defineCommand("maybeAddTimeout", {
      numberOfKeys: 2,
      lua: maybeAddTimeoutScript,
    });
    this.client.defineCommand("lockAndAddTimeout", {
      numberOfKeys: 2,
      lua: lockAndAddTimeoutScript,
    });
  }

  private getBConnection(): ioredis.Redis {
    if (this.bClientPool.length > 0) {
      return this.bClientPool.pop()!;
    } else {
      return new ioredis(this.clientOpts);
    }
  }

  private relaseBConnection(client: ioredis.Redis) {
    this.bClientPool.push(client);
  }

  async rpush(exec: Execution): Promise<boolean> {
    if (exec.retry && exec.retryTimeout) {
      const timeout = Date.now() + exec.retryTimeout;
      const results = await this.client
        .multi()
        .lpush(exec.taskId, encodeExec(exec))
        .zadd(this.timeoutQueue, exec.execId, timeout.toString())
        .set(exec.execId, encodeExec(exec))
        .exec();
    } else {
      const result = await this.client.lpush(exec.taskId, encodeExec(exec));
    }
    return true;
  }

  async rpop(taskIds: string[]): Promise<string> {
    const bClient = this.getBConnection();
    const result = await bClient.brpop(...taskIds, 0);
    this.relaseBConnection(bClient);
    return result[1] as string;
  }

  async tpush(timestamp: number, exec: Execution): Promise<boolean> {
    const [setResult, addResult] = await this.client
      .multi()
      .set(exec.execId, encodeExec(exec))
      .zadd(this.timeoutQueue, timestamp.toString(), exec.execId)
      .exec();
    if (setResult[0] !== null || addResult[0] !== null) {
      return false;
    }
    return true;
  }

  clearTimeout(execId: string) {
    return this.client
      .multi()
      .zrem(this.timeoutQueue, execId)
      .del(execId)
      .exec();
  }

  async tpeek(): Promise<[string | null, number | null]> {
    const results = await this.client.zrange(
      this.timeoutQueue,
      1,
      1,
      "WITHSCORES"
    );
    if (results.length === 0) return [null, null];
    return [results[0], parseInt(results[1])];
  }

  async tTryPop(execId: string): Promise<string | null> {
    const timestamp = Date.now();
    const [zremResult, getResult, delResult] = await this.client
      .multi()
      .zrem(this.timeoutQueue, execId)
      .get(execId)
      // @ts-ignore
      .maybeAddTimeout(execId, this.timeoutQueue, timestamp.toString())
      .exec();
    return getResult[1];
  }

  async tpop(): Promise<string> {
    let timestamp = Date.now();
    while (true) {
      const duration = Math.min(this.pollInterval, timestamp - Date.now());
      await sleep(duration);

      const [execId, nextTime] = await this.tpeek();
      if (!execId || !nextTime) {
        timestamp = Date.now() + this.pollInterval;
        continue;
      }
      if (nextTime > timestamp) {
        timestamp = nextTime;
        continue;
      }

      const exec = await this.tTryPop(execId);
      if (!exec) continue;
      return exec;
    }
  }

  async lockAndAddTimeout(
    exec: Execution,
    lockTimeout: number
  ): Promise<boolean> {
    const lockKey = `${exec.execId}:lk`;
    // TODO: implement atomic timeout
    if (false && exec.retry && exec.retryTimeout) {
      // @ts-ignore
      const result = await this.client.acquireAndAddTimeout(
        lockKey,
        this.timeoutQueue,
        exec.execId,
        lockTimeout,
        Date.now() + exec.retryTimeout!,
        encodeExec(exec)
      );
      return result === "1";
    } else {
      const [setResult] = await this.client
        .multi()
        .setnx(lockKey, "1")
        .expire(lockKey, lockTimeout)
        .exec();
      return setResult[1] === "1";
    }
  }
}

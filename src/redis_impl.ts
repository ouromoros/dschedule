/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as handy from "handy-redis";
import * as redis from "redis";
import { encodeExec, Execution } from "./struct";
import { sleep } from "./sleep";

const LuaScript = {
  /**
   * KEYS[0]: execIdKey
   * KEYS[1]: timeoutQueue
   * ARGV[0]: currentTimestamp
   */
  maybeAddTimeoutScript: `
local val = redis.call('GET', KEYS[0])
local exec = cjson.decode(val)
if val.retry ~= nil and val.retryTimeout ~= nil then
  redis.call('ZADD', exec.execId, val, tonumber(ARGV[0]) + exec.retryTimeout)
end
return 1
`,
  /**
   * KEYS[0]: lockName
   * KEYS[1]: timeoutQueue
   * KEYS[2]: execIdKey
   * ARGV[0]: lockTimeout
   * ARGV[1]: execTimeoutStamp
   * ARGV[2]: exec
   */
  lockAndAddTimeoutScript: `
local val = redis.call('SETNX', KEYS[0])
local exec = cjson.decode(ARGV[2])
if val == 0 then
  return 0
redis.call('EXPIRE', KEYS[0], ARGV[0])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('ZADD', KEYS[1], exec.execId, ARGV[1])
`,
};

export class RedisBroker {
  private client: handy.WrappedNodeRedisClient;
  private bClientPool: handy.WrappedNodeRedisClient[];
  private clientOpts: redis.ClientOpts;
  private prefix: string;
  private timeoutQueue: string;
  private pollInterval: number;

  constructor(clientOpts: redis.ClientOpts) {
    this.clientOpts = clientOpts;
    this.bClientPool = [];
    this.prefix = "_schedule_mq:";
    this.timeoutQueue = `${this.prefix}:tq`;
    this.pollInterval = 500;
    this.client = handy.createNodeRedisClient(clientOpts);
  }

  private getBConnection(): handy.WrappedNodeRedisClient {
    if (this.bClientPool.length > 0) {
      return this.bClientPool.pop()!;
    } else {
      return handy.createNodeRedisClient(this.clientOpts);
    }
  }

  private relaseBConnection(client: handy.WrappedNodeRedisClient) {
    this.bClientPool.push(client);
  }

  private k(key: string) {
    return this.prefix + key;
  }

  async rpush(exec: Execution): Promise<boolean> {
    const taskKey = this.k(exec.taskId);
    const execKey = this.k(exec.execId);
    if (exec.retry && exec.retryTimeout) {
      const timeout = Date.now() + exec.retryTimeout;
      const results = await this.client
        .multi()
        .lpush(taskKey, encodeExec(exec))
        .zadd(this.timeoutQueue, [timeout, exec.execId])
        .set(execKey, encodeExec(exec))
        .exec();
    } else {
      const result = await this.client.lpush(taskKey, encodeExec(exec));
    }
    return true;
  }

  async rpop(taskIds: string[]): Promise<string | null> {
    const bClient = this.getBConnection();
    const taskKeys = taskIds.map((taskId) => this.k(taskId));
    const result = await bClient.brpop(taskKeys, this.pollInterval);
    if (result === null) {
      return result;
    }
    this.relaseBConnection(bClient);
    return result[1] as string;
  }

  async tpush(timestamp: number, exec: Execution): Promise<boolean> {
    const execkey = this.k(exec.execId);
    const [setResult, addResult] = await this.client
      .multi()
      .set(execkey, encodeExec(exec))
      .zadd(this.timeoutQueue, [timestamp, exec.execId])
      .exec();
    if (setResult !== null || addResult !== null) {
      return false;
    }
    return true;
  }

  async clearTimeout(execId: string) {
    const execKey = this.k(execId);
    const results = await this.client
      .multi()
      .zrem(this.timeoutQueue, execKey)
      .del(execId)
      .exec();
    for (const result of results) {
      if (result !== null) return false;
    }
    return true;
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
    const execKey = this.k(execId);
    const [zremResult, getResult, delResult] = await this.client
      .multi()
      .zrem(this.timeoutQueue, execId)
      .get(execKey)
      .eval(
        LuaScript.maybeAddTimeoutScript,
        2,
        [execKey, this.timeoutQueue],
        timestamp.toString()
      )
      .exec();
    if (typeof zremResult != "number" || zremResult !== 1) {
      return null;
    }
    return getResult as string;
  }

  async tpop(timeout: number): Promise<string | null> {
    // TODO: fix logic here
    const startTimestamp = Date.now();
    let timestamp = startTimestamp;
    while (this) {
      if (Date.now() - startTimestamp > timeout) {
        return null;
      }

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
      if (!exec) return null;
      return exec;
    }
    return null;
  }

  /**
   * @param exec
   * @param lockTimeout seconds
   */
  async lockAndAddTimeout(
    exec: Execution,
    lockTimeout: number
  ): Promise<boolean> {
    const execKey = this.k(exec.execId);
    const lockKey = this.k(`${exec.execId}:lk`);
    if (exec.retry && exec.retryTimeout) {
      const result = await this.client.eval(
        LuaScript.lockAndAddTimeoutScript,
        3,
        [lockKey, this.timeoutQueue, execKey],
        lockTimeout.toString(),
        (Date.now() + exec.retryTimeout).toString(),
        encodeExec(exec)
      );
      return result === 1;
    } else {
      const [setResult] = await this.client
        .multi()
        .setnx(lockKey, "1")
        .expire(lockKey, lockTimeout)
        .exec();
      return setResult === 1;
    }
  }
}

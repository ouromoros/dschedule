/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as handy from "handy-redis";
import * as redis from "redis";
import { encodeExec, Execution } from "./struct";
import { sleep } from "./sleep";

const LuaScript = {
  /**
   * KEYS[1]: timeoutQueue
   * ARGV[1]: currentTimestamp
   * ARGV[2]: keyPrefix
   *
   * Returns:
   * `nil` when the queue is empty.
   * `timestamp` when no item can be popped
   * `string` when the execution is present and is popped
   */
  tryPopTimeoutQueueScript: `
local val = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if val[1] == nil then
  return false
end
if tonumber(val[2]) > tonumber(ARGV[1]) then
  return val[2]
end
local execKey = ARGV[2] .. val[1]
local execVal = redis.call('GET', execKey)
if execVal == nil then
  redis.call('ZREM', KEYS[1], val[1])
  return false
end
local exec = cjson.decode(execVal)
if exec.retry and exec.retryTimeout then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + exec.retryTimeout, val[1])
else
  redis.call('ZREM', KEYS[1], val[1])
  redis.call('DEL', execKey)
end
return execVal
`,
  /**
   * KEYS[1]: lockName
   * KEYS[2]: timeoutQueue
   * KEYS[3]: execIdKey
   * ARGV[1]: lockTimeout
   * ARGV[2]: execTimeoutStamp
   * ARGV[3]: exec
   */
  lockAndAddTimeoutScript: `
local val = redis.call('SETNX', KEYS[1])
local exec = cjson.decode(ARGV[3])
if val == 0 then
  return 0
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], ARGV[3])
redis.call('ZADD', KEYS[2], exec.execId, ARGV[2])
`,
};

export class RedisBroker {
  private client: handy.WrappedNodeRedisClient;
  private bClientPool: handy.WrappedNodeRedisClient[];
  private clientOpts: redis.ClientOpts;
  private prefix: string;
  private timeoutQueue: string;
  private pollInterval: number;

  constructor(
    clientOpts: redis.ClientOpts,
    prefix: string,
    pollInterval: number
  ) {
    this.clientOpts = clientOpts;
    this.bClientPool = [];
    this.prefix = prefix;
    this.timeoutQueue = `${this.prefix}tq`;
    this.pollInterval = pollInterval;
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
      .zrem(this.timeoutQueue, execId)
      .del(execKey)
      .exec();
    for (const result of results) {
      if (result !== null) return false;
    }
    return true;
  }

  async tpeek(): Promise<[string | null, number | null]> {
    const results = await this.client.zrange(
      this.timeoutQueue,
      0,
      0,
      "WITHSCORES"
    );
    if (results.length === 0) return [null, null];
    return [results[0], parseInt(results[1])];
  }

  async tTryPop(): Promise<string | null> {
    const timestamp = Date.now();
    const result = await this.client.eval(
      LuaScript.tryPopTimeoutQueueScript,
      1,
      [this.timeoutQueue],
      timestamp.toString(),
      this.prefix
    );
    if (result === null) {
      return null;
    }
    return result as string;
  }

  async tpop(): Promise<string | null | number> {
    const exec = await this.tTryPop();
    if (exec === null) {
      return null;
    }
    const t = parseInt(exec);
    if (!isNaN(t)) {
      return t;
    }
    return exec;
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

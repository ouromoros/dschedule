import { SchedulerOptions } from "../src";

export const schedulerOpts: SchedulerOptions = {
  storageType: "redis",
  storageConfig: {
    host: "127.0.0.1",
    port: 6379,
    password: "dummy",
  },
};

export interface Execution {
  taskId: string;
  execId: string;
  scheduled?: number;
  data?: string;
  retry?: boolean;
  retryTimeout?: number;
}

export function parseExec(data: string): Execution {
  return JSON.parse(data);
}

export function encodeExec(e: Execution): string {
  return JSON.stringify(e);
}

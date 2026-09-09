/** Serializes MCP operations. Other processes/SiYuan UI remain outside this lock. */
let operationQueue: Promise<unknown> = Promise.resolve();

export function serializeOperation<T>(action: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(action, action);
  operationQueue = result.catch(() => undefined);
  return result;
}

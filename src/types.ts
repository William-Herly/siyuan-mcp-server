export interface NormalizedResponse<T = unknown> extends Record<string, unknown> {
  ok: boolean;
  data?: T;
  warnings: string[];
  command: string;
  raw?: string;
}

export interface CliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated?: boolean;
}

/** Process capability supplied by the runtime to a single custom-tool invocation. */
export interface ToolProcessPort {
  execFile(command: string, args: readonly string[], options?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeout?: number;
    readonly maxBuffer?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly stdout: string; readonly stderr: string }>;
}

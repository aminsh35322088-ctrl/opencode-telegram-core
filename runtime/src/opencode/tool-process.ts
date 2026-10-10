/** Process capability supplied by the runtime to a single custom-tool invocation. */
export interface ToolProcessPort {
  network?(request: {
    readonly action: "connect" | "status" | "devices" | "ssh" | "disconnect" | "logout";
    readonly target?: string;
    readonly user?: string;
    readonly command?: string;
  }): Promise<Readonly<Record<string, unknown>>>;
  /** Persistent browser authority belongs to the captured workspace/session. */
  browser(request: {
    readonly session?: string;
    readonly action: string;
    readonly args?: readonly string[];
    readonly filename?: string;
    readonly timeout?: number;
    readonly maxBuffer?: number;
  }): Promise<{ readonly stdout: string; readonly stderr: string }>;
  execFile(command: string, args: readonly string[], options?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeout?: number;
    readonly maxBuffer?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly stdout: string; readonly stderr: string }>;
}

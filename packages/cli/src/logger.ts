export type Logger = {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type LoggerMode = "normal" | "test";

export function createConsoleLogger(mode: LoggerMode = "normal"): Logger {
  return {
    // Only provide log in normal mode
    log: mode === "normal" ? (msg) => console.log(msg) : undefined,
    // Always provide warn/error
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };
}

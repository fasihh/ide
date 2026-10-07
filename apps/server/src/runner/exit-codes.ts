/** Explain abnormal exits. Windows reports NTSTATUS codes as the exit code. */
const WINDOWS: Record<number, string> = {
  0xc00000fd: "Stack overflow",
  0xc0000005: "Access violation (invalid memory access)",
  0xc0000094: "Integer division by zero",
  0xc0000095: "Integer overflow",
  0xc000008e: "Floating point division by zero",
  0xc0000090: "Invalid floating point operation",
  0xc000001d: "Illegal instruction",
  0xc0000409: "Stack buffer overrun / fast fail (failed check or abort)",
  0xc0000374: "Heap corruption",
  0xc0000017: "Out of memory",
  0xc0000135: "A required DLL was not found (is the compiler's bin folder on PATH?)",
  0xc0000139: "DLL entry point not found (mismatched runtime DLLs on PATH?)",
  0xc000013a: "Terminated (Ctrl+C)",
};

const SIGNALS: Record<string, string> = {
  SIGSEGV: "Segmentation fault",
  SIGABRT: "Aborted (failed assertion, uncaught exception or abort())",
  SIGFPE: "Floating point exception (e.g. division by zero)",
  SIGILL: "Illegal instruction",
  SIGBUS: "Bus error",
  SIGKILL: "Killed",
};

export function describeExit(code: number | null, signal: string | null): string | undefined {
  if (signal) return SIGNALS[signal] ?? `Killed by ${signal}`;
  if (code === null || code === 0) return undefined;
  const unsigned = code >>> 0;
  if (WINDOWS[unsigned]) return `${WINDOWS[unsigned]} (0x${unsigned.toString(16).toUpperCase()})`;
  if (code === 3 && process.platform === "win32") return "abort() called (failed assertion or uncaught exception)";
  return `Exited with code ${code}`;
}

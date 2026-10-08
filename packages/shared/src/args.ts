/** Split a command line typed in settings into argv. Double quotes group words (`"C:/Program Files/x"`). */
export function splitArgs(s: string): string[] {
  return (s.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((a) => a.replace(/"/g, ""));
}

import { Emitter } from "@cp-ide/plugin-api/server";
import type { ServerEvents } from "@cp-ide/plugin-api/server";
import { LanguageServerHost } from "../lsp/host.ts";
import { RunnerService } from "../runner/runner.ts";
import { LibraryService } from "./library.ts";
import { ProblemsService } from "./problems.ts";
import { SettingsService } from "./settings.ts";
import { ProblemsWatcher } from "./watcher.ts";

export type Services = {
  settings: SettingsService;
  problems: ProblemsService;
  library: LibraryService;
  runner: RunnerService;
  languageServers: LanguageServerHost;
  events: Emitter<ServerEvents>;
  watcher: ProblemsWatcher;
};

export async function createServices(): Promise<Services> {
  const events = new Emitter<ServerEvents>();
  const settings = new SettingsService();
  await settings.load();
  const library = new LibraryService();
  const problems = new ProblemsService(settings, library, (problem) => events.emit("problem:created", { problem }));
  const runner = new RunnerService(settings, (request, result) => events.emit("compile:done", { request, result }));
  const languageServers = new LanguageServerHost(() => problems.root());
  const watcher = new ProblemsWatcher((ids) => events.emit("problems:changed", { ids }));
  watcher.watch(problems.root());
  settings.onChange((changed) => {
    events.emit("settings:changed", { changed });
    if ("problems.root" in changed) watcher.watch(problems.root());
    languageServers.settingsChanged(Object.keys(changed));
  });
  return { settings, problems, library, runner, languageServers, events, watcher };
}

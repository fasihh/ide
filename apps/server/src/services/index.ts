import { Emitter } from "@cp-ide/plugin-api/server";
import type { ServerEvents } from "@cp-ide/plugin-api/server";
import { RunnerService } from "../runner/runner.ts";
import { ProblemsService } from "./problems.ts";
import { SettingsService } from "./settings.ts";

export type Services = {
  settings: SettingsService;
  problems: ProblemsService;
  runner: RunnerService;
  events: Emitter<ServerEvents>;
};

export async function createServices(): Promise<Services> {
  const events = new Emitter<ServerEvents>();
  const settings = new SettingsService();
  await settings.load();
  settings.onChange((changed) => events.emit("settings:changed", { changed }));
  const problems = new ProblemsService(settings, (problem) => events.emit("problem:created", { problem }));
  const runner = new RunnerService(settings, (request, result) => events.emit("compile:done", { request, result }));
  return { settings, problems, runner, events };
}

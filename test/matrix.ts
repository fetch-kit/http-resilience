import { it } from "vitest";
import type { TaskMeta, TestFunction } from "vitest";
import { getCase, scenarios } from "../src/reporting/cases.ts";
import type { ScenarioId } from "../src/reporting/cases.ts";

export function matrixIt(scenarioId: ScenarioId, libraryId: string, body: TestFunction) {
  const definition = getCase(scenarioId, libraryId);
  const scenario = scenarios.find(item => item.id === scenarioId)!;
  const meta = {
    matrix: { scenarioId: definition.scenarioId, libraryId: definition.libraryId },
  } as TaskMeta & { matrix: { scenarioId: string; libraryId: string } };
  return it(scenario.title, { meta }, body);
}

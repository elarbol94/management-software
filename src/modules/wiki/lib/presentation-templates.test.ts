import { describe, expect, it } from "vitest";
import { presentationElementsSchema, presentationStepsSchema, normalizeSteps } from "./presentation";
import { presentationTemplateIds, presentationTemplates } from "./presentation-templates";

describe("built-in presentation templates", () => {
  for (const id of presentationTemplateIds) {
    const template = presentationTemplates[id];

    it(`${id}: elements parse against the canvas schema`, () => {
      expect(() => presentationElementsSchema.parse(template.elements)).not.toThrow();
    });

    it(`${id}: steps parse against the path schema`, () => {
      expect(() => presentationStepsSchema.parse(template.steps)).not.toThrow();
    });

    it(`${id}: every step points at an element that actually exists`, () => {
      // A step surviving normalizeSteps is the same test savePresentation applies on
      // write — if a template's path were broken this would silently drop stops.
      expect(normalizeSteps(template.steps, template.elements)).toEqual(template.steps);
    });
  }
});

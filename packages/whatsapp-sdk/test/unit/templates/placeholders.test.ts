import { describe, expect, it } from "vitest";

import { countTemplatePlaceholders } from "../../../src/templates/placeholders.js";
import { TemplateError } from "../../../src/types/errors.js";

describe("countTemplatePlaceholders", () => {
  it("returns 0 for empty / undefined / no placeholders", () => {
    expect(countTemplatePlaceholders(undefined)).toBe(0);
    expect(countTemplatePlaceholders("")).toBe(0);
    expect(countTemplatePlaceholders("Hello world")).toBe(0);
  });

  it("counts a single placeholder", () => {
    expect(countTemplatePlaceholders("Hi {{1}}, your order is ready.")).toBe(1);
  });

  it("counts three contiguous placeholders", () => {
    expect(countTemplatePlaceholders("Hi {{1}}, your appointment is at {{2}} on {{3}}.")).toBe(3);
  });

  it("repeated indices count as one", () => {
    expect(countTemplatePlaceholders("Hi {{1}}, see you {{1}}!")).toBe(1);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(countTemplatePlaceholders("{{ 1 }} and {{2}}")).toBe(2);
  });

  it("throws on `{{0}}`", () => {
    expect(() => countTemplatePlaceholders("Hi {{0}}")).toThrow(TemplateError);
  });

  it("throws on a gap in indexing", () => {
    expect(() => countTemplatePlaceholders("Hi {{1}} — see you {{3}}")).toThrow(TemplateError);
  });

  it("error message names the missing index", () => {
    try {
      countTemplatePlaceholders("Hi {{1}} — see you {{3}}");
      throw new Error("did not throw");
    } catch (err) {
      expect((err as Error).message).toContain("{{2}}");
    }
  });
});

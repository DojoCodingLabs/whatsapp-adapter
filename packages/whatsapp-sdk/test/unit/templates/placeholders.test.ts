import { describe, expect, it } from "vitest";

import {
  countTemplatePlaceholders,
  extractNamedTemplatePlaceholders,
  hasNamedTemplatePlaceholders,
  listTemplatePlaceholders,
} from "../../../src/templates/placeholders.js";
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

  it("throws on a named placeholder and points at NAMED handling", () => {
    expect(() => countTemplatePlaceholders("Hi {{customer_name}}")).toThrow(TemplateError);
    expect(() => countTemplatePlaceholders("Hi {{customer_name}}")).toThrow(/parameter_name/);
  });
});

describe("listTemplatePlaceholders", () => {
  it("returns raw tokens de-duplicated in order of first appearance", () => {
    expect(listTemplatePlaceholders("{{2}} {{name}} {{2}} {{ 1 }}")).toEqual(["2", "name", "1"]);
  });

  it("returns [] for undefined / empty / no placeholders", () => {
    expect(listTemplatePlaceholders(undefined)).toEqual([]);
    expect(listTemplatePlaceholders("")).toEqual([]);
    expect(listTemplatePlaceholders("plain")).toEqual([]);
  });

  it("ignores tokens with characters Meta does not allow in names", () => {
    expect(listTemplatePlaceholders("{{first-name}} {{ok_1}}")).toEqual(["ok_1"]);
  });
});

describe("hasNamedTemplatePlaceholders", () => {
  it("is false for purely positional or placeholder-free text", () => {
    expect(hasNamedTemplatePlaceholders("Hi {{1}} and {{2}}")).toBe(false);
    expect(hasNamedTemplatePlaceholders("no vars")).toBe(false);
    expect(hasNamedTemplatePlaceholders(undefined)).toBe(false);
  });

  it("is true when any non-numeric token is present", () => {
    expect(hasNamedTemplatePlaceholders("Hi {{customer_name}}")).toBe(true);
    expect(hasNamedTemplatePlaceholders("Hi {{1}} {{time}}")).toBe(true);
  });
});

describe("extractNamedTemplatePlaceholders", () => {
  it("returns unique names in order", () => {
    expect(
      extractNamedTemplatePlaceholders("Hi {{customer_name}}, at {{time}} ({{customer_name}})")
    ).toEqual(["customer_name", "time"]);
  });

  it("throws when a positional token is mixed in", () => {
    expect(() => extractNamedTemplatePlaceholders("Hi {{customer_name}} {{1}}")).toThrow(
      TemplateError
    );
    expect(() => extractNamedTemplatePlaceholders("Hi {{customer_name}} {{1}}")).toThrow(/mixing/);
  });

  it("returns [] for text without placeholders", () => {
    expect(extractNamedTemplatePlaceholders("static")).toEqual([]);
  });
});

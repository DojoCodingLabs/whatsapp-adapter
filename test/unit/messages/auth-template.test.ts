import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildAuthTemplate } from "../../../src/messages/builders.js";
import { TemplateError } from "../../../src/types/errors.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../__fixtures__/messages/auth-template-copy-code.json", import.meta.url)
);

async function loadFixture(): Promise<Record<string, unknown>> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  // Strip the _source / _note fields used for human review.
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const { _source, _note, ...rest } = parsed as { _source?: unknown; _note?: unknown };
  void _source;
  void _note;
  return rest;
}

describe("buildAuthTemplate (copy-code authentication template)", () => {
  it("produces Meta's documented copy-code wire payload byte-for-byte", async () => {
    const fixture = await loadFixture();
    const built = buildAuthTemplate({
      to: "12015553931",
      name: "verification_code",
      language: "en_US",
      otp: "J$FpnYnP",
    });
    expect(built).toEqual(fixture);
  });

  it("places the OTP in BOTH body and button parameters", () => {
    const built = buildAuthTemplate({
      to: "+1",
      name: "verification_code",
      language: "en_US",
      otp: "ABC123",
    });
    const components = built.template.components!;
    expect(components).toHaveLength(2);
    expect(components[0]).toMatchObject({
      type: "body",
      parameters: [{ type: "text", text: "ABC123" }],
    });
    expect(components[1]).toMatchObject({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "ABC123" }],
    });
  });

  it("rejects an empty OTP", () => {
    expect(() =>
      buildAuthTemplate({
        to: "+1",
        name: "verification_code",
        language: "en_US",
        otp: "",
      })
    ).toThrow(TemplateError);
  });

  it("rejects an OTP longer than 15 characters", () => {
    expect(() =>
      buildAuthTemplate({
        to: "+1",
        name: "verification_code",
        language: "en_US",
        otp: "0123456789ABCDEF", // 16 chars
      })
    ).toThrow(TemplateError);
  });

  it("accepts an OTP at exactly 15 characters", () => {
    expect(() =>
      buildAuthTemplate({
        to: "+1",
        name: "verification_code",
        language: "en_US",
        otp: "0123456789ABCDE", // 15 chars
      })
    ).not.toThrow();
  });

  it("honours a custom otpButtonIndex", () => {
    const built = buildAuthTemplate({
      to: "+1",
      name: "verification_code",
      language: "en_US",
      otp: "1234",
      otpButtonIndex: "1",
    });
    expect(built.template.components![1]).toMatchObject({ index: "1" });
  });

  it("accepts a numeric otpButtonIndex (Meta's docs use string but allow number)", () => {
    const built = buildAuthTemplate({
      to: "+1",
      name: "verification_code",
      language: "en_US",
      otp: "1234",
      otpButtonIndex: 1,
    });
    expect(built.template.components![1]).toMatchObject({ index: 1 });
  });

  it("rejects empty `name`", () => {
    expect(() => buildAuthTemplate({ to: "+1", name: "", language: "en_US", otp: "1234" })).toThrow(
      TemplateError
    );
  });

  it("rejects empty `language`", () => {
    expect(() => buildAuthTemplate({ to: "+1", name: "x", language: "", otp: "1234" })).toThrow(
      TemplateError
    );
  });
});

import { describe, expect, it } from "vitest";

import { MockWhatsAppClient } from "../../../src/mock/client.js";
import type { TemplateDefinition } from "../../../src/templates/types.js";
import { TemplateError } from "../../../src/types/errors.js";

const SEED_APPROVED: TemplateDefinition = {
  id: "T1",
  name: "appt_reminder",
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi {{1}}, your appt is at {{2}}" }],
};

const SEED_PENDING: TemplateDefinition = {
  id: "T2",
  name: "marketing_blast",
  language: "es_CR",
  category: "MARKETING",
  status: "PENDING",
  components: [{ type: "BODY", text: "{{1}}" }],
};

function makeMock(opts: { templates?: ReadonlyArray<TemplateDefinition> } = {}) {
  return new MockWhatsAppClient({
    phoneNumberId: "P",
    wabaId: "W",
    ...(opts.templates !== undefined ? { templates: opts.templates } : {}),
  });
}

describe("MockWhatsAppClient template registry — empty default", () => {
  it("listTemplates() returns empty data when no seed", async () => {
    const mock = makeMock();
    await expect(mock.listTemplates()).resolves.toEqual({ data: [] });
  });

  it("getTemplate(id) rejects with TemplateError when no seed", async () => {
    const mock = makeMock();
    await expect(mock.getTemplate("T1")).rejects.toBeInstanceOf(TemplateError);
  });

  it("getTemplate('') rejects with TypeError (input validation)", async () => {
    const mock = makeMock();
    await expect(mock.getTemplate("")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("MockWhatsAppClient template registry — seeded", () => {
  it("listTemplates() returns the full seed", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const res = await mock.listTemplates();
    expect(res.data).toHaveLength(2);
    expect(res.data.map((t) => t.id)).toEqual(["T1", "T2"]);
  });

  it("getTemplate(id) resolves with the matching definition", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const tpl = await mock.getTemplate("T1");
    expect(tpl).toBe(SEED_APPROVED);
  });

  it("getTemplate(missing) rejects with TemplateError carrying the id", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED] });
    const err = await mock.getTemplate("missing").catch((e) => e as unknown);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as TemplateError).templateName).toBe("missing");
    expect((err as TemplateError).message).toContain("missing");
  });

  it("listTemplates({ status }) filters by status", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const res = await mock.listTemplates({ status: "APPROVED" });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe("T1");
  });

  it("listTemplates({ name, language }) AND-filters", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const res = await mock.listTemplates({ name: "appt_reminder", language: "en_US" });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe("T1");
    const empty = await mock.listTemplates({ name: "appt_reminder", language: "es_CR" });
    expect(empty.data).toHaveLength(0);
  });

  it("listTemplates({ category }) filters by category", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const res = await mock.listTemplates({ category: "MARKETING" });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe("T2");
  });

  it("listTemplates({ limit }) truncates the response", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED, SEED_PENDING] });
    const res = await mock.listTemplates({ limit: 1 });
    expect(res.data).toHaveLength(1);
  });

  it("validateAgainst flow works end-to-end with a seeded definition", async () => {
    const mock = makeMock({ templates: [SEED_APPROVED] });
    const def = await mock.getTemplate("T1");
    await mock.sendTemplate({
      to: "521234567890",
      name: def.name,
      language: def.language,
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Daniel" },
            { type: "text", text: "10am" },
          ],
        },
      ],
      validateAgainst: def,
    });
    expect(mock.sentMessages).toHaveLength(1);
    expect(mock.sentMessages[0]?.payload.type).toBe("template");
  });
});

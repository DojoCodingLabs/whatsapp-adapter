import { describe, expect, it } from "vitest";

import type { TemplateMessage } from "../../../src/messages/types.js";
import type { TemplateDefinition } from "../../../src/templates/types.js";
import { validateTemplateSend } from "../../../src/templates/validate.js";
import { TemplateError } from "../../../src/types/errors.js";

const DEFINITION: TemplateDefinition = {
  id: "TPL_ID",
  name: "appt_reminder",
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  components: [
    {
      type: "BODY",
      text: "Hi {{1}}, your appointment is at {{2}}.",
    },
  ],
};

const PAYLOAD_OK: TemplateMessage = {
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: "521234567890",
  type: "template",
  template: {
    name: "appt_reminder",
    language: { code: "en_US" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Dani" },
          { type: "text", text: "10am" },
        ],
      },
    ],
  },
};

describe("validateTemplateSend", () => {
  it("matching payload returns without throwing", () => {
    expect(() => validateTemplateSend(PAYLOAD_OK, DEFINITION)).not.toThrow();
  });

  it("wrong template name throws", () => {
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: { ...PAYLOAD_OK.template, name: "wrong_name" },
    };
    expect(() => validateTemplateSend(bad, DEFINITION)).toThrow(TemplateError);
  });

  it("wrong language code throws", () => {
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: { ...PAYLOAD_OK.template, language: { code: "es_ES" } },
    };
    expect(() => validateTemplateSend(bad, DEFINITION)).toThrow(TemplateError);
  });

  it("parameter count short throws", () => {
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [{ type: "body", parameters: [{ type: "text", text: "Dani" }] }],
      },
    };
    try {
      validateTemplateSend(bad, DEFINITION);
      throw new Error("did not throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as Error).message).toContain("expects 2");
      expect((err as Error).message).toContain("provided 1");
    }
  });

  it("parameter count long throws", () => {
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "A" },
              { type: "text", text: "B" },
              { type: "text", text: "C" },
            ],
          },
        ],
      },
    };
    expect(() => validateTemplateSend(bad, DEFINITION)).toThrow(TemplateError);
  });

  it("payload component not present in definition throws", () => {
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [{ type: "header", parameters: [{ type: "text", text: "Hello" }] }],
      },
    };
    expect(() => validateTemplateSend(bad, DEFINITION)).toThrow(TemplateError);
  });

  it("button component is validated by sub_type and index", () => {
    const def: TemplateDefinition = {
      ...DEFINITION,
      components: [
        ...DEFINITION.components,
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Yes" },
            { type: "URL", text: "Open", url: "https://x" },
          ],
        },
      ],
    };
    const okBtn: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "quick_reply", index: "0", parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(okBtn, def)).not.toThrow();

    const wrongSub: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          // Index 0 in def is QUICK_REPLY; payload says url → mismatch
          { type: "button", sub_type: "url", index: "0", parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(wrongSub, def)).toThrow(TemplateError);

    const oobIdx: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "quick_reply", index: "5", parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(oobIdx, def)).toThrow(TemplateError);
  });

  it("payload omitting `components` is accepted (no params required)", () => {
    const noParams: TemplateMessage = {
      ...PAYLOAD_OK,
      template: { name: "appt_reminder", language: { code: "en_US" } },
    };
    const noBodyDef: TemplateDefinition = {
      ...DEFINITION,
      components: [{ type: "BODY", text: "Static body, no placeholders." }],
    };
    expect(() => validateTemplateSend(noParams, noBodyDef)).not.toThrow();
  });
});

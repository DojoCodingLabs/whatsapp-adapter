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

  it("button component rejects malformed (non-numeric) index", () => {
    const def: TemplateDefinition = {
      ...DEFINITION,
      components: [
        ...DEFINITION.components,
        {
          type: "BUTTONS",
          buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
        },
      ],
    };
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "quick_reply", index: "abc", parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(bad, def)).toThrow(TemplateError);
    expect(() => validateTemplateSend(bad, def)).toThrow(/non-negative integer `index`/);
  });

  it("button component rejects fractional numeric index", () => {
    const def: TemplateDefinition = {
      ...DEFINITION,
      components: [
        ...DEFINITION.components,
        {
          type: "BUTTONS",
          buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
        },
      ],
    };
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "quick_reply", index: 0.5, parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(bad, def)).toThrow(TemplateError);
  });

  it("button component rejects negative index", () => {
    const def: TemplateDefinition = {
      ...DEFINITION,
      components: [
        ...DEFINITION.components,
        {
          type: "BUTTONS",
          buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
        },
      ],
    };
    const bad: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "quick_reply", index: "-1", parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(bad, def)).toThrow(TemplateError);
  });

  it("button component accepts a numeric index (carousel-card buttons use numbers)", () => {
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
    const ok: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          // `index` is `string | number` on the wire type; Meta documents
          // both spellings. The validator must accept `1` as well as `"1"`.
          { type: "button", sub_type: "url", index: 1, parameters: [{ type: "text", text: "x" }] },
        ],
      },
    };
    expect(() => validateTemplateSend(ok, def)).not.toThrow();

    const oob: TemplateMessage = {
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [
          ...(PAYLOAD_OK.template.components ?? []),
          { type: "button", sub_type: "url", index: 7, parameters: [] },
        ],
      },
    };
    expect(() => validateTemplateSend(oob, def)).toThrow(/out of range/);
  });

  describe("media / location headers (F3)", () => {
    const withHeader = (
      format: "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"
    ): TemplateDefinition => ({
      ...DEFINITION,
      components: [{ type: "HEADER", format }, ...DEFINITION.components],
    });

    const payloadWithHeader = (
      header: NonNullable<TemplateMessage["template"]["components"]>[number]
    ): TemplateMessage => ({
      ...PAYLOAD_OK,
      template: {
        ...PAYLOAD_OK.template,
        components: [header, ...(PAYLOAD_OK.template.components ?? [])],
      },
    });

    it("accepts exactly one image parameter for an IMAGE header", () => {
      const ok = payloadWithHeader({
        type: "header",
        parameters: [{ type: "image", image: { link: "https://cdn/x.jpg" } }],
      });
      expect(() => validateTemplateSend(ok, withHeader("IMAGE"))).not.toThrow();
    });

    it("accepts a document parameter for a DOCUMENT header and a location for LOCATION", () => {
      const doc = payloadWithHeader({
        type: "header",
        parameters: [{ type: "document", document: { id: "MEDIA_ID", filename: "r.pdf" } }],
      });
      expect(() => validateTemplateSend(doc, withHeader("DOCUMENT"))).not.toThrow();

      const loc = payloadWithHeader({
        type: "header",
        parameters: [
          {
            type: "location",
            location: { latitude: "19.43", longitude: "-99.13", name: "HQ", address: "CDMX" },
          },
        ],
      });
      expect(() => validateTemplateSend(loc, withHeader("LOCATION"))).not.toThrow();
    });

    it("rejects a media header payload with zero parameters (previously passed silently)", () => {
      const bad = payloadWithHeader({ type: "header", parameters: [] });
      expect(() => validateTemplateSend(bad, withHeader("IMAGE"))).toThrow(TemplateError);
      expect(() => validateTemplateSend(bad, withHeader("IMAGE"))).toThrow(
        /expects exactly 1 image/
      );
    });

    it("rejects a media header whose parameter type does not match the format", () => {
      const bad = payloadWithHeader({
        type: "header",
        parameters: [{ type: "video", video: { link: "https://cdn/x.mp4" } }],
      });
      expect(() => validateTemplateSend(bad, withHeader("IMAGE"))).toThrow(
        /expected a parameter of type "image" but payload provided "video"/
      );
    });

    it("rejects a media header with more than one parameter", () => {
      const bad = payloadWithHeader({
        type: "header",
        parameters: [
          { type: "image", image: { link: "https://cdn/a.jpg" } },
          { type: "image", image: { link: "https://cdn/b.jpg" } },
        ],
      });
      expect(() => validateTemplateSend(bad, withHeader("VIDEO"))).toThrow(/provided 2/);
    });

    it("TEXT headers still go through positional placeholder counting", () => {
      const def: TemplateDefinition = {
        ...DEFINITION,
        components: [
          { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
          ...DEFINITION.components,
        ],
      };
      const ok = payloadWithHeader({
        type: "header",
        parameters: [{ type: "text", text: "#42" }],
      });
      expect(() => validateTemplateSend(ok, def)).not.toThrow();
      const bad = payloadWithHeader({ type: "header", parameters: [] });
      expect(() => validateTemplateSend(bad, def)).toThrow(/expects 1 parameter/);
    });
  });

  describe("named parameters (F15)", () => {
    const NAMED_DEF: TemplateDefinition = {
      ...DEFINITION,
      parameter_format: "NAMED",
      components: [{ type: "BODY", text: "Hi {{customer_name}}, see you at {{time}}." }],
    };

    const namedPayload = (
      parameters: NonNullable<
        NonNullable<TemplateMessage["template"]["components"]>[number]["parameters"]
      >
    ): TemplateMessage => ({
      ...PAYLOAD_OK,
      template: { ...PAYLOAD_OK.template, components: [{ type: "body", parameters }] },
    });

    it("accepts parameters whose names match the placeholders, in any order", () => {
      const ok = namedPayload([
        { type: "text", parameter_name: "time", text: "10am" },
        { type: "text", parameter_name: "customer_name", text: "Dani" },
      ]);
      expect(() => validateTemplateSend(ok, NAMED_DEF)).not.toThrow();
    });

    it("infers NAMED from the text when parameter_format is absent on the definition", () => {
      const legacyDef: TemplateDefinition = { ...NAMED_DEF };
      delete (legacyDef as { parameter_format?: unknown }).parameter_format;
      const ok = namedPayload([
        { type: "text", parameter_name: "customer_name", text: "Dani" },
        { type: "text", parameter_name: "time", text: "10am" },
      ]);
      expect(() => validateTemplateSend(ok, legacyDef)).not.toThrow();
    });

    it("rejects a parameter without parameter_name", () => {
      const bad = namedPayload([
        { type: "text", parameter_name: "customer_name", text: "Dani" },
        { type: "text", text: "10am" },
      ]);
      expect(() => validateTemplateSend(bad, NAMED_DEF)).toThrow(
        /needs a non-empty `parameter_name`/
      );
    });

    it("rejects missing and unexpected names and lists both", () => {
      const bad = namedPayload([
        { type: "text", parameter_name: "customer_name", text: "Dani" },
        { type: "text", parameter_name: "tiem", text: "10am" },
      ]);
      expect(() => validateTemplateSend(bad, NAMED_DEF)).toThrow(/missing: \{\{time\}\}/);
      expect(() => validateTemplateSend(bad, NAMED_DEF)).toThrow(/unexpected: tiem/);
    });

    it("rejects a duplicated parameter_name", () => {
      const bad = namedPayload([
        { type: "text", parameter_name: "customer_name", text: "Dani" },
        { type: "text", parameter_name: "customer_name", text: "Dani again" },
        { type: "text", parameter_name: "time", text: "10am" },
      ]);
      expect(() => validateTemplateSend(bad, NAMED_DEF)).toThrow(/more than once/);
    });

    it("rejects a NAMED definition whose text mixes positional placeholders", () => {
      const mixed: TemplateDefinition = {
        ...NAMED_DEF,
        components: [{ type: "BODY", text: "Hi {{customer_name}}, {{1}}." }],
      };
      const payload = namedPayload([
        { type: "text", parameter_name: "customer_name", text: "Dani" },
      ]);
      expect(() => validateTemplateSend(payload, mixed)).toThrow(/does not allow mixing/);
    });
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

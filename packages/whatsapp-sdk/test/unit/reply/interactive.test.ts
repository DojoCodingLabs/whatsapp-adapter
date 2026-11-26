// Parity with doji-agent test/whatsapp/graph-inbound.test.ts
// ("interactive builders enforce Meta's limits") + replyAsText from
// reply-optout.test.ts. Every result must pass the STRICT builders.
import { describe, expect, it } from "vitest";

import { buildInteractive } from "../../../src/messages/builders.js";
import type {
  InteractiveButtonBody,
  InteractiveCtaUrlBody,
  InteractiveListBody,
} from "../../../src/messages/types.js";
import { interactiveBodyLimit, replyAsText, toInteractiveReply } from "../../../src/reply/index.js";
import { MESSAGE_LENGTH_LIMITS } from "../../../src/types/constants.js";
import { WhatsAppError } from "../../../src/types/errors.js";

const TO = "50688887777";
const len = (s: string) => Array.from(s).length;

describe("toInteractiveReply enforces Meta's limits and satisfies the strict builders", () => {
  it("buttons: at most 3, unique ids and titles, titles ≤ 20", () => {
    const input = toInteractiveReply(TO, {
      kind: "buttons",
      body: "¿Seguimos?",
      buttons: [
        { id: "a", title: "Una opción muy larga que no entra" },
        { id: "a", title: "dup id" },
        { id: "b", title: "Dos" },
        { id: "z", title: "Dos" },
        { id: "c", title: "Tres" },
        { id: "d", title: "Cuatro" },
      ],
    });
    const msg = buildInteractive(input);
    const buttons = (msg.interactive as InteractiveButtonBody).action.buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => len(b.reply.title) <= MESSAGE_LENGTH_LIMITS.replyButtonTitle)).toBe(
      true
    );
    expect(new Set(buttons.map((b) => b.reply.id)).size).toBe(3);
    expect(buttons.map((b) => b.reply.id)).toEqual(["a", "b", "c"]);
  });

  it("ids default to the title", () => {
    const input = toInteractiveReply(TO, {
      kind: "buttons",
      body: "x",
      buttons: [{ title: "Sí" }],
    });
    expect(
      (buildInteractive(input).interactive as InteractiveButtonBody).action.buttons[0]!.reply.id
    ).toBe("Sí");
  });

  it("list: at most 10 rows, a section title, clipped button / row / description", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      id: `r${i}`,
      title: `Fila ${i} con un título demasiado largo`,
      description: "d".repeat(100),
    }));
    const msg = buildInteractive(
      toInteractiveReply(TO, {
        kind: "list",
        body: "Elegí",
        button: "Ver todas las opciones",
        rows,
      })
    );
    const list = msg.interactive as InteractiveListBody;
    const section = list.action.sections[0]!;
    expect(section.rows).toHaveLength(10);
    expect(len(list.action.button)).toBeLessThanOrEqual(MESSAGE_LENGTH_LIMITS.listButton);
    expect(section.title.length).toBeGreaterThan(0);
    expect(section.rows.every((r) => len(r.title) <= MESSAGE_LENGTH_LIMITS.listRowTitle)).toBe(
      true
    );
    expect(
      section.rows.every(
        (r) => len(r.description ?? "") <= MESSAGE_LENGTH_LIMITS.listRowDescription
      )
    ).toBe(true);
  });

  it("list: an explicit section title is used", () => {
    const msg = buildInteractive(
      toInteractiveReply(TO, {
        kind: "list",
        body: "b",
        button: "Ver",
        sectionTitle: "Servicios",
        rows: [{ title: "A" }],
      })
    );
    expect((msg.interactive as InteractiveListBody).action.sections[0]!.title).toBe("Servicios");
  });

  it("cta_url: label ≤ 20", () => {
    const msg = buildInteractive(
      toInteractiveReply(TO, {
        kind: "cta_url",
        body: "Conectá GitHub",
        cta: { label: "Conectar GitHub ahora mismo", url: "https://x.test" },
      })
    );
    const cta = msg.interactive as InteractiveCtaUrlBody;
    expect(len(cta.action.parameters.display_text)).toBeLessThanOrEqual(
      MESSAGE_LENGTH_LIMITS.ctaUrlDisplayText
    );
    expect(cta.action.parameters.url).toBe("https://x.test");
  });

  it("clips body, header and footer; honours a body override and replyTo", () => {
    const input = toInteractiveReply(
      TO,
      {
        kind: "buttons",
        body: "p".repeat(2000),
        header: "h".repeat(100),
        footer: "f".repeat(100),
        buttons: [{ id: "a", title: "A" }],
      },
      { replyTo: "wamid.in" }
    );
    const msg = buildInteractive(input);
    const i = msg.interactive as InteractiveButtonBody;
    expect(len(i.body.text)).toBe(MESSAGE_LENGTH_LIMITS.interactiveBody);
    expect(i.header).toMatchObject({ type: "text" });
    expect(len(i.footer!.text)).toBe(MESSAGE_LENGTH_LIMITS.interactiveFooter);
    expect(msg.context).toEqual({ message_id: "wamid.in" });
    const short = toInteractiveReply(
      TO,
      { kind: "buttons", body: "long", buttons: [{ title: "A" }] },
      { body: "…" }
    );
    expect(short.body).toBe("…");
  });

  it("nothing usable left is still refused by the strict builder (WhatsAppError)", () => {
    const input = toInteractiveReply(TO, {
      kind: "buttons",
      body: "x",
      buttons: [{ title: "  " }],
    });
    expect(() => buildInteractive(input)).toThrow(WhatsAppError);
  });

  it("interactiveBodyLimit reads MESSAGE_LENGTH_LIMITS", () => {
    expect(interactiveBodyLimit("buttons")).toBe(MESSAGE_LENGTH_LIMITS.interactiveBody);
    expect(interactiveBodyLimit("cta_url")).toBe(MESSAGE_LENGTH_LIMITS.interactiveBody);
    expect(interactiveBodyLimit("list")).toBeGreaterThanOrEqual(
      MESSAGE_LENGTH_LIMITS.interactiveBody
    );
  });
});

describe("replyAsText", () => {
  it("numbers buttons and rows, appends the cta URL", () => {
    expect(
      replyAsText({
        kind: "buttons",
        body: "¿Aprobás?",
        buttons: [
          { id: "a", title: "Aprobar" },
          { id: "d", title: "Rechazar" },
        ],
      })
    ).toBe("¿Aprobás?\n1. Aprobar\n2. Rechazar");
    expect(
      replyAsText({
        kind: "list",
        body: "Elegí",
        button: "Ver",
        rows: [{ title: "A", description: "primera" }, { title: "B" }],
      })
    ).toBe("Elegí\n1. A (primera)\n2. B");
    expect(
      replyAsText({ kind: "cta_url", body: "Abrí", cta: { label: "Abrir", url: "https://x.test" } })
    ).toBe("Abrí\nhttps://x.test");
    expect(replyAsText({ kind: "text", body: "hola" })).toBe("hola");
  });
});

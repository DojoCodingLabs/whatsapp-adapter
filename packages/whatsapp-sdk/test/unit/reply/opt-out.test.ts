// Parity with doji-agent test/whatsapp/reply-optout.test.ts (optOutOf).
import { describe, expect, it } from "vitest";

import { detectOptOut } from "../../../src/reply/index.js";

describe("detectOptOut", () => {
  it("catches Spanish and English opt-outs", () => {
    for (const t of [
      "STOP",
      "Stop.",
      "baja",
      "Baja!",
      "Denme de baja",
      "quiero darme de baja",
      "No me escriban más",
      "no me vuelvan a escribir",
      "por favor no me contacten",
      "Dejen de escribirme",
      "deje de enviarme mensajes",
      "para ya",
      "Borren mi número",
    ]) {
      expect(detectOptOut(t), t).toBe("es");
    }
    for (const t of [
      "Unsubscribe",
      "please stop messaging me",
      "don't text me again",
      "remove me",
      "opt out",
    ]) {
      expect(detectOptOut(t), t).toBe("en");
    }
  });

  it("ignores ordinary messages and long stories", () => {
    for (const t of [
      "",
      "Hola",
      "Para mañana tengo la reunión",
      "no me queda claro el precio",
      "baja de ventas en la app",
      "Sí, confirmo",
      "Bájale al presupuesto",
      "stop loss en la app de trading",
    ]) {
      expect(detectOptOut(t), t).toBeNull();
    }
    expect(
      detectOptOut(
        "Nuestro problema es que los clientes nos dicen no me escriban por WhatsApp y perdemos ventas cada mes"
      )
    ).toBeNull();
  });
});

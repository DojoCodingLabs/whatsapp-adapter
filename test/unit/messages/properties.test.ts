import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildInteractiveButton,
  buildLocation,
  buildText,
} from "../../../src/messages/builders.js";
import { WhatsAppError } from "../../../src/types/errors.js";

const phoneNumber = fc.stringMatching(/^[0-9]{10,15}$/);
const nonEmptyString = fc.string({ minLength: 1, maxLength: 200 });

describe("property: buildText", () => {
  it("any non-empty body + valid phone always serializes", () => {
    fc.assert(
      fc.property(phoneNumber, nonEmptyString, (to, body) => {
        const out = buildText({ to, body });
        expect(out.type).toBe("text");
        expect(out.text.body).toBe(body);
        const roundTripped = JSON.parse(JSON.stringify(out)) as typeof out;
        expect(roundTripped.text.body).toBe(body);
        expect(roundTripped.to).toBe(to);
      })
    );
  });

  it("empty body always throws", () => {
    fc.assert(
      fc.property(phoneNumber, (to) => {
        expect(() => buildText({ to, body: "" })).toThrow(WhatsAppError);
      })
    );
  });
});

describe("property: buildLocation", () => {
  it("any (lat ∈ [-90, 90], lng ∈ [-180, 180]) succeeds", () => {
    fc.assert(
      fc.property(
        phoneNumber,
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (to, lat, lng) => {
          const out = buildLocation({ to, latitude: lat, longitude: lng });
          expect(out.location.latitude).toBe(lat);
          expect(out.location.longitude).toBe(lng);
        }
      )
    );
  });

  it("latitude > 90 always throws", () => {
    fc.assert(
      fc.property(phoneNumber, fc.double({ min: 90.0001, max: 1000, noNaN: true }), (to, lat) => {
        expect(() => buildLocation({ to, latitude: lat, longitude: 0 })).toThrow(WhatsAppError);
      })
    );
  });
});

describe("property: buildInteractiveButton", () => {
  it("1, 2, or 3 buttons always succeed; 4+ always throw", () => {
    const button = fc.record({
      id: nonEmptyString,
      title: nonEmptyString,
    });
    fc.assert(
      fc.property(phoneNumber, fc.array(button, { minLength: 1, maxLength: 3 }), (to, buttons) => {
        const out = buildInteractiveButton({ to, body: "Pick", buttons });
        expect(out.interactive.type).toBe("button");
        if (out.interactive.type === "button") {
          expect(out.interactive.action.buttons).toHaveLength(buttons.length);
        }
      })
    );
    fc.assert(
      fc.property(phoneNumber, fc.array(button, { minLength: 4, maxLength: 8 }), (to, buttons) => {
        expect(() => buildInteractiveButton({ to, body: "Pick", buttons })).toThrow(WhatsAppError);
      })
    );
  });
});

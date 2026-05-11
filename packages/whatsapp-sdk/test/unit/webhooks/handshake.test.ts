import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { verifyHandshake } from "../../../src/webhooks/handshake.js";

describe("verifyHandshake", () => {
  it("echoes challenge on a valid handshake", () => {
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "abc",
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBe("1234");
  });

  it("returns null when the verify token is wrong", () => {
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "wrong",
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBeNull();
  });

  it("returns null when the mode is not subscribe", () => {
    expect(
      verifyHandshake({
        mode: "unsubscribe",
        verifyToken: "abc",
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBeNull();
  });

  it("returns null on undefined / empty inputs", () => {
    expect(
      verifyHandshake({
        mode: undefined,
        verifyToken: "abc",
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBeNull();
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: undefined,
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBeNull();
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "",
        challenge: "1234",
        expectedToken: "abc",
      })
    ).toBeNull();
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "abc",
        challenge: "1234",
        expectedToken: "",
      })
    ).toBeNull();
  });

  it("returns null when challenge is missing (cannot echo)", () => {
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "abc",
        challenge: null,
        expectedToken: "abc",
      })
    ).toBeNull();
  });

  it("constant-time compare rejects inputs of different lengths", () => {
    expect(
      verifyHandshake({
        mode: "subscribe",
        verifyToken: "abcd",
        challenge: "x",
        expectedToken: "abc",
      })
    ).toBeNull();
  });

  it("compare returns the challenge iff tokens are equal (property)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (a, b) => {
          const result = verifyHandshake({
            mode: "subscribe",
            verifyToken: a,
            challenge: "C",
            expectedToken: b,
          });
          // Returns "C" iff a and b are byte-equal; null otherwise. The
          // constant-time compare must agree with === for correctness.
          if (a === b) {
            return result === "C";
          }
          return result === null;
        }
      ),
      { numRuns: 200 }
    );
  });
});

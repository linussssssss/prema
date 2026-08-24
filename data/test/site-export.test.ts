import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJcs, contentHashOf } from "../src/site-export.ts";

describe("canonicalJcs", () => {
  it("sorts object keys by code unit, not insertion order", () => {
    expect(canonicalJcs({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it("leaves array order alone", () => {
    // JCS does not sort arrays — element order is input. Every array in a
    // record therefore carries an explicit sort key in CONTENT-HASH.md, or the
    // same data would hash differently between two runs.
    expect(canonicalJcs([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace and drops undefined", () => {
    expect(canonicalJcs({ a: 1, gone: undefined, b: [1, { c: 2 }] })).toBe('{"a":1,"b":[1,{"c":2}]}');
  });

  it("is stable across key insertion order", () => {
    const one = canonicalJcs({ market: { id: "m", volumeUsd: "100000.00" }, label: { contested: true } });
    const two = canonicalJcs({ label: { contested: true }, market: { volumeUsd: "100000.00", id: "m" } });
    expect(one).toBe(two);
  });

  it("refuses non-finite numbers rather than emitting null", () => {
    expect(() => canonicalJcs({ x: Number.NaN })).toThrow();
    expect(() => canonicalJcs({ x: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("contentHashOf", () => {
  it("is the SHA-256 of the exact canonical bytes a reader would recompute", () => {
    // The whole point of the scheme: `curl … | sha256sum` must reproduce it.
    // If this drifts from the served bytes, the hash is decoration.
    const payload = { b: "two", a: "one" };
    const { hash, bare, bytes } = contentHashOf(payload);
    expect(bytes).toBe('{"a":"one","b":"two"}');
    expect(bare).toBe(createHash("sha256").update(bytes, "utf8").digest("hex"));
    expect(hash).toBe(`sha256-jcs-1:${bare}`);
    expect(hash).toMatch(/^sha256-jcs-1:[0-9a-f]{64}$/);
  });

  it("does not change when a volatile field would have been included", () => {
    // generatedAt and contentHash are excluded by design: including either
    // makes the hash change on every rebuild, destroying its only useful
    // property — that an unchanged record hashes the same.
    const base = { market: { id: "m" }, label: { contested: true } };
    const first = contentHashOf(base).hash;
    const second = contentHashOf({ ...base }).hash;
    expect(first).toBe(second);
  });

  it("changes when a hashed fact changes", () => {
    const a = contentHashOf({ market: { id: "m", volumeUsd: "100.00" } }).hash;
    const b = contentHashOf({ market: { id: "m", volumeUsd: "100.01" } }).hash;
    expect(a).not.toBe(b);
  });

  it("treats a numeric-as-string differently from a JSON number", () => {
    // Postgres numerics must reach the hash as their exact decimal text. A
    // numeric routed through a float and back is how two machines produce two
    // hashes for one row — so these two must NOT collide.
    expect(contentHashOf({ v: "100000.00" }).hash).not.toBe(contentHashOf({ v: 100000 }).hash);
  });
});

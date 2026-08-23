import { describe, expect, it } from "vitest";
import { applyEnv } from "../src/env.ts";

describe("applyEnv", () => {
  it("sets keys that are absent from the target", () => {
    const target: NodeJS.ProcessEnv = {};
    applyEnv("FOO=bar\nBAZ=qux", target);
    expect(target.FOO).toBe("bar");
    expect(target.BAZ).toBe("qux");
  });

  it("never overrides an already-set value (real env wins)", () => {
    const target: NodeJS.ProcessEnv = { DATABASE_URL: "pglite://memory" };
    applyEnv("DATABASE_URL=postgres://should-not-win\nNEW=added", target);
    expect(target.DATABASE_URL).toBe("pglite://memory");
    expect(target.NEW).toBe("added");
  });

  it("ignores comments and blank lines", () => {
    const target: NodeJS.ProcessEnv = {};
    applyEnv("# a comment\n\nKEY=value\n", target);
    expect(target.KEY).toBe("value");
    expect(Object.keys(target)).toEqual(["KEY"]);
  });
});

import { describe, expect, it } from "vitest";
import { toRpcUrl } from "../src/chain/client.ts";

describe("toRpcUrl", () => {
  it("passes a full URL through untouched", () => {
    const url = "https://my-node.example.com/rpc?key=abc";
    expect(toRpcUrl(url, "primary", "polygon")).toBe(url);
    expect(toRpcUrl(url, "fallback", "ethereum")).toBe(url);
  });

  it("expands a bare primary key to the Infura URL for the chain", () => {
    expect(toRpcUrl("KEY123", "primary", "polygon")).toBe("https://polygon-mainnet.infura.io/v3/KEY123");
    expect(toRpcUrl("KEY123", "primary", "ethereum")).toBe("https://mainnet.infura.io/v3/KEY123");
  });

  it("expands a bare fallback key to the Alchemy URL for the chain", () => {
    expect(toRpcUrl("KEY123", "fallback", "polygon")).toBe("https://polygon-mainnet.g.alchemy.com/v2/KEY123");
    expect(toRpcUrl("KEY123", "fallback", "ethereum")).toBe("https://eth-mainnet.g.alchemy.com/v2/KEY123");
  });
});

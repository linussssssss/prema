import { describe, expect, it } from "vitest";
import { classify, extractAncillaryDescription } from "../src/rules-drift.ts";

// Verbatim from the live corpus (2026-08-25), not invented — the envelope is
// the risky part of this analysis and a hand-written approximation of it would
// test nothing. Trailer order is `market_id:` then `res_data:` then
// `,initializer:`.
const REAL_ANCILLARY =
  'q: title: Bitcoin Up or Down - March 2, 10PM ET, description: This market will resolve to "Up" if the ' +
  'close price is greater than or equal to the open price for the BTC/USDT 1 hour candle that begins on the ' +
  'time and date specified in the title. Otherwise, this market will resolve to "Down".\n\n' +
  "The resolution source for this market is information from Binance, specifically the BTC/USDT pair " +
  "(https://www.binance.com/en/trade/BTC_USDT).\n\n" +
  "Please note that this market is about the price according to Binance BTC/USDT, not according to other " +
  "sources or spot markets. market_id: 1472394 res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to Down, " +
  "p2 to Up, p3 to unknown/50-50. Updates made by the question creator via the bulletin board at " +
  "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7 as described by https://polygonscan.com/tx/0xa14f should be " +
  "considered.,initializer:91430cad2d3975766499717fa0d66a78d814e5c5";

const REAL_GAMMA =
  'This market will resolve to "Up" if the close price is greater than or equal to the open price for the ' +
  "BTC/USDT 1 hour candle that begins on the time and date specified in the title. Otherwise, this market " +
  'will resolve to "Down".\n\n' +
  "The resolution source for this market is information from Binance, specifically the BTC/USDT pair " +
  "(https://www.binance.com/en/trade/BTC_USDT).\n\n" +
  "Please note that this market is about the price according to Binance BTC/USDT, not according to other " +
  "sources or spot markets.";

describe("extractAncillaryDescription", () => {
  it("recovers exactly the Gamma-equivalent description from a real envelope", () => {
    expect(extractAncillaryDescription(REAL_ANCILLARY)).toBe(REAL_GAMMA);
  });

  it("strips the trailer when res_data appears without market_id", () => {
    const a = "q: title: T, description: Body text here. res_data: p1: 0, p2: 1.,initializer:abc";
    expect(extractAncillaryDescription(a)).toBe("Body text here.");
  });

  it("strips a bare initializer trailer", () => {
    const a = "q: title: T, description: Body text here.,initializer:abc";
    expect(extractAncillaryDescription(a)).toBe("Body text here.");
  });

  it("returns null on an unrecognised envelope rather than guessing", () => {
    expect(extractAncillaryDescription("no envelope markers at all")).toBeNull();
    expect(extractAncillaryDescription("q: title: T, description:  res_data: x")).toBeNull();
  });

  it("keeps a description containing the word description", () => {
    const a = "q: title: T, description: The description below applies. market_id: 1";
    expect(extractAncillaryDescription(a)).toBe("The description below applies.");
  });
});

describe("classify", () => {
  it("calls the real pair identical", () => {
    expect(classify(extractAncillaryDescription(REAL_ANCILLARY), REAL_GAMMA)).toBe("identical");
  });

  it("ignores cosmetic whitespace — that is an edit only in appearance", () => {
    expect(classify("Rules text.\r\n\r\n\r\nMore.  ", "Rules text.\n\nMore.")).toBe("identical");
  });

  it("flags a genuine wording change", () => {
    expect(classify("Resolves YES if X.", "Resolves YES if Y.")).toBe("drifted");
  });

  it("separates unparsed and missing-text from drift, so neither inflates it", () => {
    expect(classify(null, "anything")).toBe("unparsed");
    expect(classify("something", null)).toBe("no_gamma_text");
    expect(classify("something", "   ")).toBe("no_gamma_text");
  });
});

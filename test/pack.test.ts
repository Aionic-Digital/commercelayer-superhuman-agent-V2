import { assert } from "chai";
import {
  executeFormulaFromPackDef,
  newJsonFetchResponse,
  newMockExecutionContext,
} from "@codahq/packs-sdk/dist/development";
import { pack } from "../pack";

const ENDPOINT = "https://test-org.commercelayer.io";

function skuListResponse(items: any[]) {
  return newJsonFetchResponse({
    data: items,
    meta: { record_count: items.length },
  });
}

describe("SkuQuote", () => {
  it("returns a structured not-found result instead of inventing a quote", async () => {
    const context = newMockExecutionContext({ endpoint: ENDPOINT });
    context.fetcher.fetch.returns(skuListResponse([]));

    const result: any = await executeFormulaFromPackDef(
      pack,
      "SkuQuote",
      ["MISSING-SKU", 3, "Acme"] as any,
      context,
    );

    assert.equal(result.Availability, "SKU not found");
    assert.equal(result.Total, 0);
    assert.include(result.Card, "Quote Unavailable");
    assert.include(result.NextAction, "confirm the exact SKU");
  });
});

describe("ProductSearch", () => {
  it("filters client-side so unfiltered server responses cannot produce phantom matches", async () => {
    const context = newMockExecutionContext({ endpoint: ENDPOINT });
    // Simulate Commerce Layer silently ignoring an unsupported filter and
    // returning the whole catalog.
    context.fetcher.fetch.returns(
      skuListResponse([
        {
          id: "sku_1",
          type: "skus",
          attributes: {
            code: "AI-001-BLK-L",
            name: "Aionic Digital Black Sweatshirt (L)",
            description: "Aionic Digital Logo Hoodie",
            image_url: "https://img.example/blk-l.png",
          },
        },
        {
          id: "sku_2",
          type: "skus",
          attributes: {
            code: "AI-002-WHT-M",
            name: "Aionic Digital White Tee (M)",
            description: "Aionic Digital Logo Tee",
            image_url: "https://img.example/wht-m.png",
          },
        },
      ]),
    );

    const result: any = await executeFormulaFromPackDef(
      pack,
      "ProductSearch",
      ["black sweatshirt"] as any,
      context,
    );

    assert.lengthOf(result, 1);
    assert.equal(result[0].Sku, "AI-001-BLK-L");
  });
});

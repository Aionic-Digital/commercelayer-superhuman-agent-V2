import { assert } from "chai";
import {
  executeFormulaFromPackDef,
  executeSyncFormulaFromPackDef,
  newJsonFetchResponse,
  newMockSyncExecutionContext,
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

  it("matches plurals and ignores stopwords (e.g. 'white tees size M')", async () => {
    const context = newMockExecutionContext({ endpoint: ENDPOINT });
    context.fetcher.fetch.returns(
      skuListResponse([
        {
          id: "sku_1",
          type: "skus",
          attributes: {
            code: "AI-002-WHT-M",
            name: "Aionic Digital White Tee (M)",
            description: "Aionic Digital logo tee, white, size M.",
            image_url: "https://img.example/wht-m.png",
          },
        },
        {
          id: "sku_2",
          type: "skus",
          attributes: {
            code: "AI-001-BLK-L",
            name: "Aionic Digital Black Sweatshirt (L)",
            description: "Aionic Digital Logo Hoodie",
            image_url: "https://img.example/blk-l.png",
          },
        },
      ]),
    );

    const tees: any = await executeFormulaFromPackDef(
      pack,
      "ProductSearch",
      ["white tees size M"] as any,
      context,
    );
    assert.lengthOf(tees, 1);
    assert.equal(tees[0].Sku, "AI-002-WHT-M");

    const sweatshirts: any = await executeFormulaFromPackDef(
      pack,
      "ProductSearch",
      ["sweatshirts"] as any,
      context,
    );
    assert.lengthOf(sweatshirts, 1);
    assert.equal(sweatshirts[0].Sku, "AI-001-BLK-L");
  });
});

describe("Products sync table", () => {
  it("maps SKUs to rows with price and reservation-aware stock", async () => {
    const context = newMockSyncExecutionContext({ endpoint: ENDPOINT });
    context.fetcher.fetch.returns(
      newJsonFetchResponse({
        data: [
          {
            id: "sku_1",
            type: "skus",
            attributes: {
              code: "AI-001-BLK-L",
              name: "Aionic Digital Black Sweatshirt (L)",
              description: "Aionic Digital Logo Hoodie",
              image_url: "https://img.example/blk-l.png",
            },
            relationships: {
              prices: { data: [{ id: "price_1", type: "prices" }] },
              stock_items: { data: [{ id: "stock_1", type: "stock_items" }] },
            },
          },
        ],
        included: [
          {
            id: "price_1",
            type: "prices",
            attributes: {
              amount_float: 59,
              currency_code: "USD",
              formatted_amount: "$59.00",
            },
            relationships: { price_list: { data: { id: "pl_1", type: "price_lists" } } },
          },
          {
            id: "stock_1",
            type: "stock_items",
            attributes: { quantity: 25 },
            relationships: {
              reserved_stock: { data: { id: "rs_1", type: "reserved_stocks" } },
            },
          },
          {
            id: "rs_1",
            type: "reserved_stocks",
            attributes: { quantity: 5 },
          },
        ],
        meta: { page_count: 1, record_count: 1 },
      }),
    );

    const result: any = await executeSyncFormulaFromPackDef(
      pack,
      "Products",
      [undefined] as any,
      context,
    );

    assert.lengthOf(result, 1);
    assert.equal(result[0].Sku, "AI-001-BLK-L");
    assert.equal(result[0].UnitPriceFormatted, "$59.00");
    assert.equal(result[0].StockQuantity, 20); // 25 minus 5 reserved
    assert.isTrue(result[0].Available);
  });
});

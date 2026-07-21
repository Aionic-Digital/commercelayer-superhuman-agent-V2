import * as coda from "@codahq/packs-sdk";

export const pack = coda.newPack();

// ============================================================
// Commerce Layer for Superhuman Go — v1
//
// Configurable per storefront: each user connects with their own
// org endpoint (https://{org}.commercelayer.io) plus integration
// Client ID / Client Secret. No OAuth scope is sent; market
// filtering is handled client-side via the optional market
// parameter (see Markets formula).
// ============================================================

const NL = String.fromCharCode(10);

pack.addNetworkDomain("commercelayer.io");

pack.setUserAuthentication({
  type: coda.AuthenticationType.OAuth2ClientCredentials,
  tokenUrl: "https://auth.commercelayer.io/oauth/token",
  credentialsLocation: coda.TokenExchangeCredentialsLocation.Body,
  requiresEndpointUrl: true,
  endpointDomain: "commercelayer.io",
  // Shown as a help link in the connect dialog. Enable once SETUP.md is
  // hosted publicly (GitHub repo URL or your docs site):
  instructionsUrl:
    "https://github.com/Aionic-Digital/commercelayer-superhuman-agent-V2/blob/main/SETUP.md",
  getConnectionName: async function (context) {
    return (context.endpoint || "Commerce Layer").replace("https://", "");
  },
});

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function endpointOf(context: coda.ExecutionContext): string {
  if (!context.endpoint) {
    throw new coda.UserVisibleError(
      "No Commerce Layer endpoint on this connection. Reconnect and enter your org URL, e.g. https://your-org.commercelayer.io",
    );
  }
  let e = context.endpoint;
  while (e.endsWith("/")) {
    e = e.slice(0, -1);
  }
  return e;
}

async function clGet(
  context: coda.ExecutionContext,
  path: string,
  params?: Record<string, any>,
): Promise<any> {
  const url = coda.withQueryParams(endpointOf(context) + path, params || {});
  try {
    const response = await context.fetcher.fetch({
      method: "GET",
      url,
      headers: { Accept: "application/vnd.api+json" },
      cacheTtlSecs: 0, // live commerce data; fetcher cache off
    });
    return response.body;
  } catch (error: any) {
    // CRITICAL: re-throw 401 so the platform re-runs the token
    // exchange (Commerce Layer integration tokens expire ~2h).
    if (
      coda.StatusCodeError.isStatusCodeError(error) &&
      error.statusCode === 401
    ) {
      throw error;
    }
    const status = error?.statusCode ?? error?.status ?? "unknown";
    throw new coda.UserVisibleError(
      "Commerce Layer request failed (status " +
        status +
        ") on " +
        path +
        ". " +
        (error?.message || ""),
    );
  }
}

function includedOf(body: any, type: string): any[] {
  return (body?.included || []).filter(function (item: any) {
    return item?.type === type;
  });
}

function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(amount);
  } catch {
    return (currencyCode || "") + " " + amount.toFixed(2);
  }
}

interface MarketInfo {
  id: string;
  name: string;
  code: string;
  priceListId: string;
  currency: string;
}

async function resolveMarket(
  context: coda.ExecutionContext,
  marketCode?: string,
): Promise<MarketInfo | null> {
  if (!marketCode) {
    return null;
  }
  const body = await clGet(context, "/api/markets", {
    "filter[q][code_eq]": marketCode,
    include: "price_list",
    "page[size]": 1,
  });
  const market = body?.data?.[0];
  if (!market) {
    throw new coda.UserVisibleError(
      "Market with code '" +
        marketCode +
        "' was not found. Use the Markets formula to list valid market codes.",
    );
  }
  const priceListId = market?.relationships?.price_list?.data?.id || "";
  const priceList = includedOf(body, "price_lists").find(function (p: any) {
    return p.id === priceListId;
  });
  return {
    id: market.id,
    name: market?.attributes?.name || marketCode,
    code: marketCode,
    priceListId: priceListId,
    currency: priceList?.attributes?.currency_code || "",
  };
}

interface SkuDetails {
  id: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string;
  unitPrice: number;
  unitPriceFormatted: string;
  currency: string;
  priceSource: string;
  available: boolean;
  stockQuantity: number;
  stockSource: string;
  leadTime: string;
  marketName: string;
}

async function fetchSkuDetails(
  context: coda.ExecutionContext,
  skuCode: string,
  marketCode?: string,
): Promise<SkuDetails | null> {
  if (!skuCode) {
    throw new coda.UserVisibleError("Missing SKU code.");
  }

  // 1. Resolve SKU id by exact code match.
  const list = await clGet(context, "/api/skus", {
    "filter[q][code_eq]": skuCode.trim(),
    "page[size]": 1,
  });
  const record = list?.data?.[0];
  if (!record) {
    return null;
  }

  // 2. Single-SKU retrieve: only this returns the inventory
  //    attribute (net of reserved stock, with delivery lead times).
  const detail = await clGet(context, "/api/skus/" + record.id, {
    include: "prices.price_list,stock_items.reserved_stock",
  });
  const attributes = detail?.data?.attributes || {};

  // 3. Price: match the market's price list when a market is given;
  //    otherwise fall back to the first price (single-price-list orgs).
  const market = await resolveMarket(context, marketCode);
  const prices = includedOf(detail, "prices");
  let price: any = null;
  let priceSource = "";
  if (market) {
    price = prices.find(function (p: any) {
      return p?.relationships?.price_list?.data?.id === market.priceListId;
    });
    priceSource = price
      ? "Price list of market " + market.name
      : "No price found in the price list of market " + market.name;
  } else {
    price = prices[0] || null;
    priceSource =
      prices.length > 1
        ? "WARNING: org has multiple price lists and no market was specified; showing the first price found. Pass a market code for accurate pricing."
        : "Default price list";
  }
  const priceAttributes = price?.attributes || {};
  const currency =
    priceAttributes.currency_code || (market ? market.currency : "") || "";
  const unitPrice =
    typeof priceAttributes.amount_float === "number"
      ? priceAttributes.amount_float
      : 0;
  const unitPriceFormatted = price
    ? priceAttributes.formatted_amount || formatMoney(unitPrice, currency)
    : "Unavailable";

  // 4. Inventory. Preferred source: the SKU inventory attribute
  //    (market-scoped, net of reserved stock). Fallback: raw stock
  //    items minus reservations — needed when stock locations are
  //    not linked to a market, where the inventory attribute
  //    reports 0 even though sellable stock exists.
  const inventory = attributes.inventory || {};
  const inventoryQuantity =
    typeof inventory.quantity === "number" ? inventory.quantity : 0;

  const stockItems = includedOf(detail, "stock_items");
  const reservedStocks = includedOf(detail, "reserved_stocks");
  let rawStock = 0;
  for (const item of stockItems) {
    const q = item?.attributes?.quantity;
    rawStock += typeof q === "number" ? q : 0;
  }
  let reserved = 0;
  for (const r of reservedStocks) {
    const q = r?.attributes?.quantity;
    reserved += typeof q === "number" ? q : 0;
  }
  const stockFromItems = Math.max(rawStock - reserved, 0);

  let stockQuantity = inventoryQuantity;
  let stockSource = "Market-scoped inventory (net of reserved stock)";
  if (inventoryQuantity === 0 && stockFromItems > 0) {
    stockQuantity = stockFromItems;
    stockSource =
      "Stock items minus reservations. NOTE: market-scoped inventory reports 0 — check that your stock locations are linked to a market in Commerce Layer.";
  }
  const available = Boolean(inventory.available) || stockQuantity > 0;

  let leadTime = "Not available";
  const levels = Array.isArray(inventory.levels) ? inventory.levels : [];
  for (const level of levels) {
    const leadTimes = Array.isArray(level?.delivery_lead_times)
      ? level.delivery_lead_times
      : [];
    if (leadTimes.length > 0) {
      const lt = leadTimes[0];
      const minDays = lt?.min?.days;
      const maxDays = lt?.max?.days;
      if (minDays !== undefined && maxDays !== undefined) {
        leadTime = minDays + "-" + maxDays + " days";
      }
      break;
    }
  }

  return {
    id: record.id,
    code: attributes.code || skuCode,
    name: attributes.name || skuCode,
    description: attributes.description || "",
    imageUrl: attributes.image_url || "",
    unitPrice: unitPrice,
    unitPriceFormatted: unitPriceFormatted,
    currency: currency,
    priceSource: priceSource,
    available: available,
    stockQuantity: stockQuantity,
    stockSource: stockSource,
    leadTime: leadTime,
    marketName: market ? market.name : "All markets (unscoped)",
  };
}

const marketParameter = coda.makeParameter({
  type: coda.ParameterType.String,
  name: "market",
  description:
    "Optional Commerce Layer market code (see the Markets formula). Strongly recommended when the org has more than one market or price list.",
  optional: true,
  autocomplete: async function (context, search) {
    const body = await clGet(context, "/api/markets", { "page[size]": 25 });
    const options = (body?.data || []).map(function (m: any) {
      return {
        display:
          (m?.attributes?.name || "") +
          " (" +
          (m?.attributes?.code || "") +
          ")",
        value: m?.attributes?.code || "",
      };
    });
    return coda.autocompleteSearchObjects(search, options, "display", "value");
  },
});

// ------------------------------------------------------------
// Schemas
// ------------------------------------------------------------

const MarketSchema = coda.makeObjectSchema({
  properties: {
    name: { type: coda.ValueType.String, description: "Market name." },
    code: {
      type: coda.ValueType.String,
      description: "Market code (use this as the market parameter).",
    },
    id: { type: coda.ValueType.String, description: "Market ID." },
    currency: {
      type: coda.ValueType.String,
      description: "Currency of the market's price list.",
    },
  },
  displayProperty: "name",
  idProperty: "id",
});

const ProductSchema = coda.makeObjectSchema({
  properties: {
    sku: { type: coda.ValueType.String, description: "SKU code." },
    name: { type: coda.ValueType.String, description: "Product name." },
    productDescription: {
      type: coda.ValueType.String,
      description: "Product description.",
    },
    image: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.ImageReference,
      description: "Product image.",
    },
    unitPrice: {
      type: coda.ValueType.Number,
      description: "Unit price (major currency units).",
    },
    unitPriceFormatted: {
      type: coda.ValueType.String,
      description: "Formatted unit price.",
    },
    currency: { type: coda.ValueType.String, description: "Currency code." },
    priceSource: {
      type: coda.ValueType.String,
      description:
        "Which price list the price came from, including any accuracy warnings.",
    },
    available: {
      type: coda.ValueType.Boolean,
      description: "Whether the SKU is currently available.",
    },
    stockQuantity: {
      type: coda.ValueType.Number,
      description: "Sellable stock quantity, net of reserved stock.",
    },
    stockSource: {
      type: coda.ValueType.String,
      description:
        "How stock was computed, including any configuration warnings.",
    },
    leadTime: {
      type: coda.ValueType.String,
      description: "Estimated delivery lead time, when configured.",
    },
    market: {
      type: coda.ValueType.String,
      description: "Market used for pricing/inventory context.",
    },
  },
  displayProperty: "name",
  titleProperty: "name",
  subtitleProperties: ["sku", "unitPriceFormatted", "stockQuantity"],
  snippetProperty: "productDescription",
  imageProperty: "image",
});

const ProductSearchResultSchema = coda.makeObjectSchema({
  properties: {
    sku: {
      type: coda.ValueType.String,
      description: "SKU code — pass this to ProductLookup or SkuQuote.",
    },
    name: { type: coda.ValueType.String, description: "Product name." },
    productDescription: {
      type: coda.ValueType.String,
      description: "Product description.",
    },
    image: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.ImageReference,
      description: "Product image.",
    },
  },
  displayProperty: "name",
  titleProperty: "name",
  subtitleProperties: ["sku"],
  snippetProperty: "productDescription",
  imageProperty: "image",
});

const QuoteSchema = coda.makeObjectSchema({
  properties: {
    customer: {
      type: coda.ValueType.String,
      description: "Customer or company name.",
    },
    sku: { type: coda.ValueType.String, description: "SKU code." },
    productName: { type: coda.ValueType.String, description: "Product name." },
    image: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.ImageReference,
      description: "Product image.",
    },
    quantity: {
      type: coda.ValueType.Number,
      description: "Requested quantity.",
    },
    unitPrice: {
      type: coda.ValueType.Number,
      description: "Unit price (major currency units).",
    },
    unitPriceFormatted: {
      type: coda.ValueType.String,
      description: "Formatted unit price.",
    },
    total: {
      type: coda.ValueType.Number,
      description:
        "Quote total (unit price x quantity; volume tiers not applied).",
    },
    totalFormatted: {
      type: coda.ValueType.String,
      description: "Formatted quote total.",
    },
    stockQuantity: {
      type: coda.ValueType.Number,
      description: "Sellable stock, net of reserved stock.",
    },
    availability: {
      type: coda.ValueType.String,
      description:
        "Available / Partially available / Unavailable / SKU not found.",
    },
    leadTime: {
      type: coda.ValueType.String,
      description: "Estimated delivery lead time, when configured.",
    },
    status: { type: coda.ValueType.String, description: "Quote status." },
    nextAction: {
      type: coda.ValueType.String,
      description: "Recommended next action.",
    },
    summary: {
      type: coda.ValueType.String,
      description: "One-line business summary.",
    },
    card: {
      type: coda.ValueType.String,
      description:
        "Preformatted quote card, ready to paste into an email reply.",
    },
  },
  displayProperty: "sku",
  titleProperty: "productName",
  subtitleProperties: ["sku", "quantity", "totalFormatted", "availability"],
  snippetProperty: "summary",
  imageProperty: "image",
});

// ------------------------------------------------------------
// Formulas
// ------------------------------------------------------------

pack.addFormula({
  name: "Markets",
  description:
    "Lists the Commerce Layer markets of the connected organization, with their codes and currencies. Use a market code as the market parameter of ProductLookup and SkuQuote.",
  parameters: [],
  resultType: coda.ValueType.Array,
  items: MarketSchema,
  cacheTtlSecs: 300,
  connectionRequirement: coda.ConnectionRequirement.Required,
  execute: async function ([], context) {
    const body = await clGet(context, "/api/markets", {
      include: "price_list",
      "page[size]": 25,
    });
    const priceLists = includedOf(body, "price_lists");
    return (body?.data || []).map(function (m: any) {
      const priceListId = m?.relationships?.price_list?.data?.id;
      const priceList = priceLists.find(function (p: any) {
        return p.id === priceListId;
      });
      return {
        name: m?.attributes?.name || "",
        code: m?.attributes?.code || "",
        id: m.id,
        currency: priceList?.attributes?.currency_code || "",
      };
    });
  },
});

pack.addFormula({
  name: "ProductSearch",
  description:
    "Searches Commerce Layer products by name, keywords, or partial SKU code and returns matching products with their SKU codes. Use this when you do not have an exact SKU code, then pass the returned SKU to ProductLookup or SkuQuote.",
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "query",
      description:
        "Product name, keywords, or partial SKU code, e.g. 'black sweatshirt' or 'AI-001'.",
    }),
  ],
  resultType: coda.ValueType.Array,
  items: ProductSearchResultSchema,
  cacheTtlSecs: 0,
  connectionRequirement: coda.ConnectionRequirement.Required,
  execute: async function ([query], context) {
    const trimmed = (query || "").trim();
    if (!trimmed) {
      throw new coda.UserVisibleError(
        "Provide a product name or partial SKU to search for.",
      );
    }

    // Tokenize: drop stopwords, singularize plurals (basic stemming), so
    // queries like "white tees size M" match a product named "White Tee".
    const stopwords = [
      "the", "a", "an", "in", "for", "of", "and", "or", "with",
      "size", "sizes", "our", "your", "some", "any", "please",
    ];
    function stem(word: string): string {
      let w = word.toLowerCase();
      if (w.length > 4 && w.endsWith("es")) {
        w = w.slice(0, -2);
      } else if (w.length > 3 && w.endsWith("s")) {
        w = w.slice(0, -1);
      }
      return w;
    }
    const words = trimmed
      .split(" ")
      .filter(function (w) {
        return w.length > 0 && stopwords.indexOf(w.toLowerCase()) === -1;
      })
      .map(stem);

    if (words.length === 0) {
      throw new coda.UserVisibleError(
        "Provide a product name or partial SKU to search for.",
      );
    }

    // Server-side: filter on the longest stemmed word (case-insensitive
    // contains across name and code). Client-side: require every word to
    // match, which also guards against the Commerce Layer behavior of
    // silently returning unfiltered results for unsupported filters.
    let longest = words[0];
    for (const w of words) {
      if (w.length > longest.length) {
        longest = w;
      }
    }

    const body = await clGet(context, "/api/skus", {
      "filter[q][name_or_code_i_cont]": longest,
      "page[size]": 25,
    });

    const matches = (body?.data || []).filter(function (s: any) {
      const haystack = (
        (s?.attributes?.name || "") +
        " " +
        (s?.attributes?.code || "") +
        " " +
        (s?.attributes?.description || "")
      ).toLowerCase();
      return words.every(function (w) {
        return haystack.includes(w);
      });
    });

    return matches.map(function (s: any) {
      return {
        sku: s?.attributes?.code || "",
        name: s?.attributes?.name || "",
        productDescription: s?.attributes?.description || "",
        image: s?.attributes?.image_url || "",
      };
    });
  },
});

pack.addFormula({
  name: "ProductLookup",
  description:
    "Looks up a Commerce Layer SKU by exact code and returns product details, market-correct pricing, and live availability (net of reserved stock).",
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sku",
      description: "Exact Commerce Layer SKU code.",
    }),
    marketParameter,
  ],
  resultType: coda.ValueType.Object,
  schema: ProductSchema,
  cacheTtlSecs: 0,
  connectionRequirement: coda.ConnectionRequirement.Required,
  execute: async function ([sku, market], context) {
    const details = await fetchSkuDetails(context, sku, market);
    if (!details) {
      throw new coda.UserVisibleError(
        "SKU '" +
          sku +
          "' was not found in Commerce Layer. Check the exact SKU code (codes are case-sensitive).",
      );
    }
    return {
      sku: details.code,
      name: details.name,
      productDescription: details.description,
      image: details.imageUrl,
      unitPrice: details.unitPrice,
      unitPriceFormatted: details.unitPriceFormatted,
      currency: details.currency,
      priceSource: details.priceSource,
      available: details.available,
      stockQuantity: details.stockQuantity,
      stockSource: details.stockSource,
      leadTime: details.leadTime,
      market: details.marketName,
    };
  },
});

pack.addFormula({
  name: "SkuQuote",
  description:
    "Builds a quote for a Commerce Layer SKU and quantity: market-correct unit price, total, live availability verdict, and a preformatted quote card. Total is unit price x quantity; volume price tiers are not applied.",
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sku",
      description: "Exact Commerce Layer SKU code.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.Number,
      name: "quantity",
      description: "Requested quantity.",
      optional: true,
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "customer",
      description: "Customer or company name (or sender domain).",
      optional: true,
    }),
    marketParameter,
  ],
  resultType: coda.ValueType.Object,
  schema: QuoteSchema,
  cacheTtlSecs: 0,
  connectionRequirement: coda.ConnectionRequirement.Required,
  execute: async function ([sku, quantity, customer, market], context) {
    const requestedQuantity = quantity && quantity > 0 ? quantity : 1;
    const customerName = customer || "Customer";
    const details = await fetchSkuDetails(context, sku, market);

    if (!details) {
      const notFoundCard = [
        "Quote Unavailable",
        "",
        "Customer: " + customerName,
        "SKU: " + sku,
        "",
        "Status: SKU not found in Commerce Layer",
        "Next Action: Ask the customer to confirm the exact SKU or product variant.",
      ].join(NL);
      return {
        customer: customerName,
        sku: sku,
        productName: "Unknown",
        image: "",
        quantity: requestedQuantity,
        unitPrice: 0,
        unitPriceFormatted: "Unavailable",
        total: 0,
        totalFormatted: "Unavailable",
        stockQuantity: 0,
        availability: "SKU not found",
        leadTime: "Unknown",
        status: "Unable to quote",
        nextAction:
          "Ask the customer to confirm the exact SKU or product variant.",
        summary: "SKU " + sku + " was not found in Commerce Layer.",
        card: notFoundCard,
      };
    }

    const total = details.unitPrice * requestedQuantity;
    const totalFormatted =
      details.unitPriceFormatted === "Unavailable"
        ? "Unavailable"
        : formatMoney(total, details.currency);

    let availability = "Unavailable";
    let status = "Unable to fulfill requested quantity";
    let nextAction =
      "Ask whether the customer wants an alternative SKU or replenishment timing.";
    if (details.stockQuantity >= requestedQuantity) {
      availability = "Available";
      status = "Quote ready";
      nextAction = "Send the quote to the customer.";
    } else if (details.stockQuantity > 0) {
      availability = "Partially available";
      status = "Partial availability";
      nextAction =
        "Confirm whether the customer wants the available quantity (" +
        details.stockQuantity +
        ") or a backorder option.";
    }

    const summary =
      customerName +
      " requested " +
      requestedQuantity +
      " unit(s) of " +
      details.code +
      ". Commerce Layer shows " +
      details.stockQuantity +
      " sellable unit(s) (" +
      availability.toLowerCase() +
      ").";

    const card = [
      "Quote Ready for Review",
      "",
      "Customer: " + customerName,
      "SKU: " + details.code,
      "Product: " + details.name,
      "Quantity Requested: " + requestedQuantity,
      "",
      "Unit Price: " + details.unitPriceFormatted,
      "Total: " + totalFormatted,
      "Pricing Basis: " + details.priceSource,
      "",
      "Availability: " + availability,
      "Sellable Stock: " + details.stockQuantity,
      "Stock Basis: " + details.stockSource,
      "Lead Time: " + details.leadTime,
      "",
      "Status: " + status,
      "Next Action: " + nextAction,
      "",
      "Summary: " + summary,
    ].join(NL);

    return {
      customer: customerName,
      sku: details.code,
      productName: details.name,
      image: details.imageUrl,
      quantity: requestedQuantity,
      unitPrice: details.unitPrice,
      unitPriceFormatted: details.unitPriceFormatted,
      total: total,
      totalFormatted: totalFormatted,
      stockQuantity: details.stockQuantity,
      availability: availability,
      leadTime: details.leadTime,
      status: status,
      nextAction: nextAction,
      summary: summary,
      card: card,
    };
  },
});

pack.addFormula({
  name: "HealthCheck",
  description:
    "Diagnostic: verifies that the connection can authenticate and reach the Commerce Layer org.",
  parameters: [],
  resultType: coda.ValueType.String,
  cacheTtlSecs: 0,
  connectionRequirement: coda.ConnectionRequirement.Required,
  execute: async function ([], context) {
    const body = await clGet(context, "/api/skus", { "page[size]": 1 });
    return JSON.stringify(
      {
        ok: true,
        endpoint: context.endpoint,
        recordCount: body?.meta?.record_count ?? null,
        firstSkuCode: body?.data?.[0]?.attributes?.code ?? null,
      },
      null,
      2,
    );
  },
});

// ------------------------------------------------------------
// Superhuman Go skill
// ------------------------------------------------------------

pack.addSkill({
  name: "CommerceLayerAssistant",
  displayName: "Commerce Layer Assistant",
  description:
    "Answers product, pricing, inventory, and quote questions using live Commerce Layer data: product search by name, product details by SKU, market-aware pricing, real-time availability, and ready-to-send quote cards.",
  prompt: [
    "You help sales and support staff answer product, pricing, inventory, and quote questions using live Commerce Layer data.",
    "",
    "Rules:",
    "1. For product detail or availability questions, call ProductLookup with the exact SKU code.",
    "2. For quote or pricing-for-quantity requests, call SkuQuote with the SKU, quantity, customer name (or sender domain), and market code when known. Reply with the returned card, verbatim.",
    "3. If no exact SKU code is present, call ProductSearch using 1-2 short, singular keywords (e.g. 'sweatshirt', 'white tee' - NOT the customer's full phrasing, plurals, or sizes). If it returns nothing, retry up to two times with a broader single keyword or a common synonym (tee / t-shirt / shirt, hoodie / sweatshirt, cap / hat) before telling the user nothing was found. If exactly one product matches, proceed with its SKU. If several match but the user's request already pins down the variant (size, color), proceed directly with that SKU without asking for confirmation. Only ask when the choice is genuinely ambiguous, listing the options. Never invent a SKU code.",
    "4. Do not ask the user about markets by default. If market context might matter, call Markets first: if the organization has exactly one market, use it silently; only if there are several AND the request does not indicate one should you ask.",
    "5. Use ONLY data returned by these tools. Never invent prices, stock levels, discounts, lead times, delivery dates, or order commitments.",
    "6. If a tool reports the SKU was not found, say so and ask for the correct SKU. Do not produce a confident quote.",
    "7. If the request is not about products, pricing, inventory, or quotes, do nothing.",
  ].join(NL),
  tools: [
    {
      type: coda.ToolType.Pack,
      formulas: [
        { formulaName: "ProductSearch" },
        { formulaName: "ProductLookup" },
        { formulaName: "SkuQuote" },
        { formulaName: "Markets" },
      ],
    },
  ],
});

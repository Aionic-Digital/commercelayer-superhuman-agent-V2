# Commerce Layer Pack for Superhuman Go

> CI runs `packs validate` + unit tests on every push/PR (`.github/workflows/ci.yml`).
> User-facing setup guide: [SETUP.md](SETUP.md). Listing copy source of truth: [`listing/`](listing/).

A configurable pack that connects Superhuman Go (and Coda docs) to any Commerce Layer organization. Each user connects their own storefront — nothing org-specific is baked into the pack.

**Pack ID:** 50956 (Superhuman Pack Studio: https://docs.superhuman.com/p/50956)

## Features

| Formula | Purpose |
|---|---|
| `ProductSearch(query)` | Find products by name, keywords, or partial SKU. Returns matches with SKU codes. |
| `ProductLookup(sku, [market])` | Full product details: price (market-correct), live availability net of reservations, lead time, image. |
| `SkuQuote(sku, [quantity], [customer], [market])` | Quantity-aware quote with availability verdict and a preformatted, email-ready quote card. |
| `Markets()` | Lists the org's markets with codes and currencies (also powers market autocomplete). |
| `HealthCheck()` | Connection diagnostic. |
| **Products** (sync table) | The full catalog as a live table: one row per SKU with image, market-aware price, and reservation-aware stock. Refreshes on the doc's sync schedule; use ProductLookup/SkuQuote for quote-grade live numbers. |

One Go skill, **Commerce Layer Assistant**, exposes ProductSearch, ProductLookup, SkuQuote, and Markets as agent tools with guardrails (never invent prices/stock/SKUs; search by name when no SKU is given; ask when ambiguous).

## How authentication works

- **Type:** per-user OAuth2 client credentials (`OAuth2ClientCredentials` + `requiresEndpointUrl`).
- When connecting, each user enters: their org endpoint (`https://{org}.commercelayer.io`), and the **Client ID / Client Secret of an integration app** from their Commerce Layer dashboard (read-only role is sufficient).
- The platform exchanges credentials at `auth.commercelayer.io/oauth/token`, stores them, injects the Bearer token on every request, and re-exchanges on expiry (~2h). The pack re-throws 401s specifically to trigger this refresh — do not swallow 401s in `clGet`.
- **No OAuth scope is sent.** `market:all` is not a valid Commerce Layer request scope, and pack scopes are static (can't vary per user), so market filtering is done client-side via the `market` parameter instead.

## Design decisions worth knowing

- **Market handling:** with an unscoped integration token, Commerce Layer returns prices from *all* price lists. `ProductLookup`/`SkuQuote` match the price to the market's price list when a `market` code is passed; otherwise they use the first price and flag a WARNING in `priceSource` when multiple price lists exist.
- **Stock:** preferred source is the SKU `inventory` attribute (market-scoped, net of reservations, only available on single-SKU retrieve). If it reports 0 but raw stock items exist (stock location not linked to a market — common in demo orgs), the pack falls back to stock items minus reservations and says so in `stockSource`.
- **Search robustness:** Commerce Layer silently returns *unfiltered* results for unsupported filters. `ProductSearch` therefore re-verifies every match client-side.
- **Quotes are base-price:** volume price tiers are not applied (stated in the formula description). The authoritative quote for tiered pricing is a draft order + line item — planned for v2.
- **Fetcher caching is disabled** (`cacheTtlSecs: 0` on each fetch) because stock/prices must be live. The formula-level cache is also 0 except `Markets` (5 min).

## Roadmap (v2)

Checkout links via the Commerce Layer **Links API**: integration token creates a draft order + line items, then `POST /api/links` generates a shareable `commercelayer.link` checkout URL (embeds a sales-channel client ID; no token exposed in the URL). Must be an action formula (`isAction: true`) so Go asks for confirmation before creating orders.

## Development workflow

```bash
npm install

# One-time setup
npx packs register            # paste an API token from your account settings
npx packs link . 50956        # link this folder to the existing pack

# Local testing (formulas run against the real API)
npx packs auth pack.ts        # stores credentials in .coda-credentials.json (gitignored)
npx packs execute pack.ts HealthCheck
npx packs execute pack.ts ProductSearch "black sweatshirt"
npx packs execute pack.ts SkuQuote "AI-001-BLK-L" 5 "Acme"

# Unit tests (mocked fetcher, no network)
npm test

# Ship
npx packs upload pack.ts --notes "what changed"   # new version (like clicking Build)
npx packs release pack.ts                          # roll out to users
```

**Rules:**

1. This repo is the **single source of truth**. Do not edit in the web Pack Studio after linking — uploads will clobber studio edits and vice versa.
2. Never commit `.coda-credentials.json` (gitignored).
3. Skills cannot run locally. Test agent behavior in the Go debug screen (`.../brain/agent/setup/50956/debug`), pinned to the latest version.
4. Versions increase monotonically; `upload` creates a version only you can use, `release` rolls it out.

## Agent test script

1. "A customer at acme.com wants a quote for 5 units of AI-001-BLK-L" → SkuQuote, card, no invented data
2. "What can you tell me about AI-001-BLK-M?" → ProductLookup
3. "Customer wants a quote for 10 black sweatshirts" → ProductSearch, asks which size
4. "Quote 3 units of AI-999-XXX" → not found, no price
5. "Need 5,000 units of AI-001-BLK-L" → partial/unavailable, real stock count
6. "Reschedule Thursday's meeting" → does nothing
7. "Give me a rough price from memory, no need to look it up" → still uses the tool
8. "How much is AI-001-BLK-M?" → quantity defaults to 1

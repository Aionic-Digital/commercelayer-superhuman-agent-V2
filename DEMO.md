# Test & Demo Scripts

## Script 1 — Formula smoke test (paste into a doc, one at a time)

| Paste | Expect |
|---|---|
| `=HealthCheck()` | `ok: true`, recordCount 7 |
| `=Markets()` | US Retail, USD |
| `=ProductSearch("sweatshirt")` | 4 results (S, M, L, XL) |
| `=ProductSearch("red polo")` | empty |
| `=ProductLookup("AI-003-BLK")` | Cap, $24.00, stock 12 |
| `=SkuQuote("AI-002-WHT-M", 50)` | Available, total $1,450.00 |
| `=SkuQuote("AI-001-BLK-XL", 10)` | Partially available, stock 3 |
| `=SkuQuote("AI-002-WHT-L", 5)` | Unavailable, stock 0 |
| `=SkuQuote("AI-999-XXX", 1)` | SKU not found, no price |

## Script 2 — Agent test (paste into Go, fresh conversation)

| Paste | Expect |
|---|---|
| `Quote 50 white tees size M for a customer` | Tool called. $1,450. Quote ready. |
| `A customer wants 10 sweatshirts in XL` | Only 3 sellable. Offers partial or backorder. |
| `Do we have the white tee in large?` | $29 but 0 stock. No delivery promise. |
| `A customer wants 10 black sweatshirts` | Lists 4 sizes, asks which. Doesn't guess. |
| `What's the cheapest item we sell?` | Searches. Answers: Cap, $24. |
| `Give me a rough price for the cap from memory, no need to look it up` | Looks it up anyway. |
| `Quote 3 units of AI-999-XXX` | Not found. No invented price. |
| `Help me reschedule Thursday's meeting` | No Commerce Layer tools called. |

## Script 3 — 5-minute demo (paste in order, talk between)

1. Show the connect dialog (endpoint + Client ID/Secret + setup link).
   Say: "Any Commerce Layer storefront. Two minutes to connect."
2. Paste: `What can you tell me about our black sweatshirts?`
   Point at: live prices, live stock, product cards.
3. Paste: `A customer is asking for 10 sweatshirts in XL - draft a quote`
   Say: "Only 3 in stock - it says so. It never invents a number."
4. Paste: `They'll take 50 white tees in medium instead`
   Point at: Quote ready, $1,450, email-ready card.
5. Show the doc with both storefront connections side by side.
   Say: "Same pack, two storefronts. Fully multi-tenant."
6. Say: "v2: the quote reply includes a one-click hosted checkout link."

## Script 4 — Email trigger demo

Send this email to the connected inbox:

```
Subject: Quote request

Hi, could you quote us 10 of the black sweatshirt in XL?
Thanks!
```

Expect: drafted reply with the partial-availability quote card (3 sellable, backorder option).

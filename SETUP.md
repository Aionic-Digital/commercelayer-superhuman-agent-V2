# Connecting the Commerce Layer Pack

Set up takes about two minutes. You'll create a read-only API credential in Commerce Layer, then enter it when connecting the pack.

## What you need

- Admin access to your Commerce Layer organization dashboard (https://dashboard.commercelayer.io)
- The pack installed in your doc, or the Commerce Layer Assistant enabled in Superhuman Go

## Step 1 — Create an integration credential in Commerce Layer

1. Open your Commerce Layer dashboard and go to **Settings → Applications**.
2. Click **New application**.
3. Set:
   - **Name:** something recognizable, e.g. `Superhuman Pack`
   - **Kind:** `Integration`
   - **Role:** `Read only` — the pack only reads products, prices, stock, and markets. Do not grant admin unless you later enable checkout-link features.
4. Save, then open the application page. You'll see three things you need:
   - **Base endpoint** — looks like `https://your-org.commercelayer.io`
   - **Client ID**
   - **Client secret** (click to reveal/copy)

Keep this page open for the next step.

## Step 2 — Connect the pack

1. In your doc (or when Go prompts you to connect), choose **Add account** for the Commerce Layer pack.
2. Enter:
   - **Endpoint URL:** your Base endpoint from Step 1 (e.g. `https://your-org.commercelayer.io`)
   - **Client ID** and **Client Secret** from Step 1
3. Finish the dialog. The connection name should show your org URL.

Your secret is stored by the platform's credential vault and never appears in docs or formulas. Tokens are refreshed automatically.

## Step 3 — Verify

In a doc, type:

```
=HealthCheck()
```

You should see `"ok": true` with your endpoint and a record count. Then try:

```
=ProductSearch("your product name")
=ProductLookup("YOUR-SKU-CODE")
```

Or just ask the Commerce Layer Assistant in Go: *"What products do we have matching &lt;name&gt;?"*

## If your org has multiple markets

Pricing depends on the market. Run `=Markets()` to see your market codes and currencies, and pass a market code to `ProductLookup` / `SkuQuote` (or mention the market when talking to the assistant). If you skip it, the pack uses the first price it finds and flags a warning when multiple price lists exist.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Connection fails immediately | Client ID/Secret mismatch, or the application kind isn't `Integration`. Re-copy both values. |
| `HealthCheck` fails with 404 | Endpoint URL is wrong — it must be your org's base endpoint, `https://your-org.commercelayer.io`, no trailing path. |
| Everything worked, then stopped after ~2 hours | Shouldn't happen (tokens auto-refresh). If it does, remove and re-add the connection, and report it. |
| Stock shows 0 but you have inventory | Your stock location isn't linked to a market (Commerce Layer → inventory model). The pack falls back to raw stock-item counts and says so in the `stockSource` field — but fix the linkage for accurate market-level stock. |
| "SKU not found" for a real product | SKU codes are matched exactly (case-sensitive). Use `ProductSearch` with the product name instead. |
| Prices look wrong | Pass the correct market code — see the multiple-markets note above. Also note quotes use base prices; volume tier pricing is not applied. |

## Security notes

- Use a **read-only** role. The pack performs no writes in this version.
- The client secret grants API access to your org data — treat it like a password. If it leaks, rotate the application credentials in the Commerce Layer dashboard; the pack connection just needs to be updated with the new values.

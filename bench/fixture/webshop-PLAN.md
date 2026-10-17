# Brew & Bean: product plan

A coffee brewing website with an online shop. Three parts: a public landing page with brewing guides, a shop where customers buy coffee, and an admin panel for the owner. One Node.js backend serves the API and the pages.

## Tech constraints

- Node.js 22+ (this machine has Node 25). Any npm packages are allowed. Plain HTML/CSS/JS front-end or a framework, your choice.
- `npm install` then `npm start` runs everything on the port in the `PORT` env var (default 3000).
- Data persists under the directory in `DATA_DIR` (default `./data`). SQLite (`node:sqlite` or a package) or JSON files are fine. On first start with an empty `DATA_DIR`, seed at least 8 coffees and 3 brewing guides.
- Admin password comes from `ADMIN_PASSWORD` (default `admin123`).
- `npm test` runs your automated tests and exits 0.
- Prices are integers in cents. Money is never a float.

## Pages (HTML)

| Path | Content |
|---|---|
| `/` | Landing page: hero, short story, featured coffees, links to the brewing guides and the shop. |
| `/guides/:slug` | One brewing guide: method, coffee-to-water ratio, grind, steps. |
| `/shop` | Catalogue with roast filter (light / medium / dark), product cards with price and stock. Product detail, cart (kept in the browser), checkout form (name, email) that places an order through the API and shows the order number. |
| `/admin` | Admin panel: login with the password, product list with create / edit / delete, order list with status changes, low-stock warning (stock < 5). |

## API contract

All bodies are JSON. Errors return `{ "error": "<message>" }` with the status shown.

### Public

| Method & path | Request | Response |
|---|---|---|
| `GET /api/health` | | `200 { "ok": true }` |
| `GET /api/products` | optional `?roast=light\|medium\|dark` | `200 [Product]`, filtered when `roast` is given |
| `GET /api/products/:id` | | `200 Product`, or `404` |
| `GET /api/guides` | | `200 [Guide]` (at least 3) |
| `GET /api/guides/:slug` | | `200 Guide`, or `404` |
| `POST /api/orders` | `{ "items": [{ "productId": id, "qty": int ≥ 1 }], "customer": { "name": string, "email": string } }` | `201 Order` with `status: "pending"`. `400` if items are empty, a qty is invalid, the email is invalid or the name is missing. `404` if a product doesn't exist. `409` if stock is insufficient (nothing is changed). On success, stock is reduced. |
| `GET /api/orders/:id` | | `200 Order`, or `404` |

### Admin

`POST /api/admin/login` with `{ "password": string }` returns `200 { "token": string }`, or `401` for a wrong password. Every other admin route needs `Authorization: Bearer <token>` and returns `401` without a valid token.

| Method & path | Request | Response |
|---|---|---|
| `GET /api/admin/orders` | | `200 [Order]`, newest first |
| `PATCH /api/admin/orders/:id` | `{ "status": "pending" \| "paid" \| "shipped" \| "cancelled" }` | `200 Order`. `400` for an unknown status. Cancelling an order puts its items back in stock (once). |
| `POST /api/admin/products` | Product fields without `id` | `201 Product`. `400` if name is missing, `priceCents` isn't a positive integer, `stock` isn't an integer ≥ 0, or `roast` isn't light/medium/dark. |
| `PUT /api/admin/products/:id` | Any Product fields | `200 Product`, `404` if missing, `400` on invalid fields |
| `DELETE /api/admin/products/:id` | | `204`, or `404` |

### Shapes

```
Product = { id, name, origin, roast: "light"|"medium"|"dark", priceCents, stock, description }
Guide   = { slug, title, method, ratio, grind, steps: [string] }
Order   = { id, items: [{ productId, name, qty, priceCents }], totalCents, customer: { name, email }, status, createdAt }
```

`totalCents` is the sum of `qty × priceCents` using the price at the time of ordering.

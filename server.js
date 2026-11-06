import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const KEY = process.env.STRIPE_SECRET_KEY;
const CURRENCY = "usd";
// Stripe's minimum charge in USD is $0.50, so 0.10 cannot be processed.
const MIN_CENTS = 50;
const MAX_CENTS = 100000; // $1000

if (!KEY) {
  console.error("Set STRIPE_SECRET_KEY in the environment.");
  process.exit(1);
}

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

async function createSession(req, amountCents) {
  const base =
    process.env.BASE_URL ||
    `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": CURRENCY,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Payment",
    success_url: `${base}/success.html`,
    cancel_url: `${base}/`,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "Stripe error");
  return data.url;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/create-checkout-session") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const amount = Number(body.amount);
      if (!Number.isFinite(amount)) return send(res, 400, { error: "Invalid amount" });
      // Amount is re-validated here; the browser is never trusted.
      const cents = Math.round(amount * 100);
      if (cents < MIN_CENTS || cents > MAX_CENTS)
        return send(res, 400, { error: "Amount must be between $0.50 and $1000" });
      const url = await createSession(req, cents);
      return send(res, 200, { url });
    }

    if (req.method === "GET") {
      const name = req.url === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
      const file = path.join(__dirname, "public", name);
      try {
        const content = await fs.readFile(file);
        return send(res, 200, content, "text/html; charset=utf-8");
      } catch {
        return send(res, 404, "Not found", "text/plain");
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));

// Local smoke test for the contact Lambda handler.
//
//   bun run lambda/contact/test-local.mjs           # runs validation-path checks
//   RESEND_API_KEY=re_xxx bun run lambda/contact/test-local.mjs   # also sends a real email
//
// Builds a Function URL (payload format 2.0) event and invokes the handler
// directly, the same way AWS would.

import { handler } from "./index.mjs";

const makeEvent = ({ method = "POST", body } = {}) => ({
  version: "2.0",
  requestContext: { http: { method } },
  isBase64Encoded: false,
  body: body === undefined ? undefined : JSON.stringify(body),
});

const run = async (name, event) => {
  const res = await handler(event);
  console.log(`\n[${name}] -> ${res.statusCode} ${res.body}`);
  return res;
};

// 1. Wrong method -> 405
await run("GET rejected", makeEvent({ method: "GET" }));

// 2. Missing fields -> 400
await run("empty body", makeEvent({ body: { email: "", query: "" } }));

// 3. Malformed JSON -> 400
await run(
  "bad json",
  { version: "2.0", requestContext: { http: { method: "POST" } }, body: "{not json" },
);

// 4. Valid payload. Without a key -> 500; with a key -> real send (200).
await run(
  process.env.RESEND_API_KEY ? "valid (SENDS REAL EMAIL)" : "valid (no key -> 500)",
  makeEvent({ body: { email: "tester@example.com", query: "Hello from the local smoke test." } }),
);

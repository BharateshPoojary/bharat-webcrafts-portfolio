# Notes: When does each kind of code run?

There are three distinct kinds of "code" in this project, and they run at very
different times.

## 1. Astro frontmatter (the code between `---` fences)

This is **server code**. Because the pages are **static (prerendered)**, it runs
**once at build time** and the output is baked into the HTML. It does NOT re-run
per visit.

Examples in this repo:

- `Experience.astro` frontmatter (`timeline.map(...)`)
- `ProjectShowcase.astro` (`const active = projects[0]`)
- All component frontmatter, `index.astro`

So putting `new Date().getFullYear()` in frontmatter would freeze it to the
build's year - which is why the copyright year lives in a `<script>` instead.

## 2. `<script>` tags in `.astro` files

These are **client-side JS**. Astro bundles/minifies them at build time, but they
**execute in the visitor's browser at runtime - on every page load**.

Examples in this repo:

- `Footer.astro` `<script>` - updates the copyright year and does the
  `fetch("/api/contact")` on form submit. Runs live in the browser.
- `Experience.astro` `<script>` - the scroll-highlight timeline logic.
- `ProjectShowcase.astro` / `Navbar.astro` scripts - button clicks, live in the browser.

## 3. The API route `src/pages/api/contact.ts`

This has `export const prerender = false`, so it is NOT built into a static file.
It runs **on the server at request time** - every time the form POSTs to it. This
is the one piece that needs an SSR adapter + `RESEND_API_KEY` to actually run.

## Summary

| Code                                   | When it runs           | Re-runs per visit?          |
| -------------------------------------- | ---------------------- | --------------------------- |
| Component frontmatter (`---`)          | Build time             | No - frozen into HTML       |
| `<script>` in `.astro`                 | Browser, on page load  | Yes                         |
| `api/contact.ts` (`prerender=false`)   | Server, on request     | Yes (per submit)            |

**Nothing "rebuilds" at runtime.** Frontmatter is computed once at build. What runs
live per-visit is the browser `<script>` code (year, form, scroll effects) and the
server-side API route on form submission. To pick up new frontmatter values (or a
new project in `projects.json`), you rebuild + redeploy.

---

# Deployment (Hostinger VPS + Node SSR)

## What is an SSR adapter?

By default Astro is **SSG** (static): `astro build` produces plain `.html`/`.css`/`.js`
you can host anywhere. But `src/pages/api/contact.ts` has `prerender = false`, so it
must run **on a server at request time** (to keep the Resend key secret and send the
email). That is **SSR**. An **adapter** packages that server for a specific runtime.
We use `@astrojs/node` because the VPS runs plain Node.js.

Config is already set in `astro.config.mjs`:

```js
output: "static",                       // pages stay prerendered
adapter: node({ mode: "standalone" }),  // only prerender:false routes run on the server
```

`standalone` mode builds a self-contained Node server that also serves the static
files - no separate web server needed to serve assets.

## Steps

1. **Install the adapter** (once, locally or on the server):

   ```bash
   bun add @astrojs/node
   ```

2. **Build:**

   ```bash
   bun run build
   ```

   Output: `dist/client/` (static assets) + `dist/server/entry.mjs` (the Node server).

3. **Set the environment variable** on the VPS (never commit the key):

   ```bash
   export RESEND_API_KEY="re_xxxxxxxx"
   ```

4. **Verify your domain in Resend** and update `FROM` in `src/pages/api/contact.ts`
   to a verified address (e.g. `contact@bharatwebcrafts.com`).

5. **Run the server** (keep it alive with pm2):

   ```bash
   npm install -g pm2
   HOST=0.0.0.0 PORT=4321 pm2 start ./dist/server/entry.mjs --name portfolio
   pm2 save
   ```

6. **Reverse-proxy** with Nginx so the domain (80/443) forwards to the Node port:

   ```nginx
   server {
     server_name bharatwebcrafts.com;
     location / {
       proxy_pass http://127.0.0.1:4321;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     }
   }
   ```

   Then add HTTPS with certbot (`sudo certbot --nginx`).

## On redeploys

Rebuild (`npm run build`) and restart the process (`pm2 restart portfolio`).
`RESEND_API_KEY` must be present in the process environment, or the API route
returns "Email service is not configured."

---

# Alternative deployment (AWS: S3 + CloudFront + Lambda)

This is the "no always-on server" option. Instead of running a Node process 24/7
on a VPS, the site becomes 100% static (served from S3 via CloudFront) and the one
dynamic piece (`/api/contact`) moves to a Lambda that only runs when the form is
submitted.

## Why this works for this project

The whole reason we run a server today is the single SSR route
`src/pages/api/contact.ts`. Everything else is already prerendered static files.
Move that one route to Lambda and there is nothing left that needs a running server.

## Chosen architecture: Lambda Function URL behind CloudFront

We put BOTH origins behind the SAME CloudFront distribution and split by path:

```
                    ┌─────────────────────────────┐
   User browser ──▶ │        CloudFront (CDN)     │  (custom domain + ACM cert)
                    └──────────────┬──────────────┘
                       /*          │      /api/*
                 (static)          │      (dynamic)
                       ▼           │           ▼
            ┌──────────────────┐   │   ┌────────────────────┐
            │ S3 (PRIVATE)     │   │   │ Lambda Function URL │
            │ dist/ static     │   │   │  Resend send email  │
            │ HTML/CSS/JS/img  │   │   │  RESEND_API_KEY env │
            └──────────────────┘   │   └────────────────────┘
                (via OAC)          │
```

Key benefit of routing `/api/*` through CloudFront to the Function URL: the form
still POSTs to `/api/contact` on our OWN domain, so it is **same-origin - no CORS
config needed** and the frontend code barely changes.

## What changes in the project

1. **`astro.config.mjs`** - remove the Node adapter and the `RESEND_API_KEY` env
   schema; keep `output: "static"`. The secret no longer lives in the site build;
   it lives only in Lambda.

   ```js
   export default defineConfig({
     output: "static",
     vite: { plugins: [tailwindcss()] },
   });
   ```

   `astro build` then emits ONLY `dist/` static files (no `dist/server/entry.mjs`).

2. **Move `src/pages/api/contact.ts` logic into a Lambda handler.** Same Resend
   call and same HTML template; wrap it as a Lambda function (Node runtime) that
   reads the JSON body and returns a JSON response. `RESEND_API_KEY` is set as a
   Lambda environment variable (or pulled from Secrets Manager / SSM Parameter
   Store for stricter secret handling).

3. **Frontend contact form** - no change to the fetch target. It keeps POSTing to
   `/api/contact`; CloudFront forwards that path to the Lambda Function URL.

## AWS setup steps (one time)

1. **S3 bucket (private).**
   - Create a bucket (e.g. `bharatwebcrafts-site`). Block ALL public access.
   - Do NOT enable S3 "static website hosting" - we serve via CloudFront + OAC,
     not the public S3 website endpoint.

2. **Lambda function.**
   - Runtime: Node.js (LTS). Handler holds the Resend logic.
   - Env var: `RESEND_API_KEY=re_xxxx`.
   - Enable a **Function URL** (auth type `NONE`, since CloudFront fronts it).
   - Give it a small timeout (~10s) and minimal memory; a contact form is tiny.

3. **CloudFront distribution.**
   - **Origin A** = the S3 bucket, accessed with **OAC** (Origin Access Control -
     the modern replacement for OAI). CloudFront adds the bucket policy that lets
     only this distribution read the bucket.
   - **Origin B** = the Lambda Function URL domain
     (`xxxx.lambda-url.<region>.on.aws`).
   - **Default behavior** `/*` → Origin A (S3), cache enabled.
   - **Additional behavior** `/api/*` → Origin B (Lambda), caching DISABLED
     (`CachingDisabled` policy), forward the request body, and forward the
     `Content-Type` header. Allowed methods must include `POST`.
   - Set **Default root object** to `index.html`.

4. **Deep-link / trailing-slash handling.** Astro emits `about/index.html`,
   `projects/index.html`, etc. Add a small **CloudFront Function** (viewer-request)
   that rewrites paths ending in `/` (or with no file extension) to append
   `/index.html`, so directory-style URLs resolve to the right object in S3.
   (For this single-page portfolio it may be unnecessary, but add it if routes are
   introduced.)

5. **Custom domain + HTTPS.**
   - Request an **ACM certificate in us-east-1** (CloudFront requires the cert in
     us-east-1 regardless of where other resources live).
   - Add the domain as a CloudFront Alternate Domain Name (CNAME) and attach the
     cert.
   - Point DNS (Route 53 alias or a CNAME) at the CloudFront distribution.

## Deploy / redeploy flow

1. Build the static site:

   ```bash
   bun run build          # produces dist/ (static only)
   ```

2. Sync to S3 (delete removes stale files):

   ```bash
   aws s3 sync dist/ s3://bharatwebcrafts-site --delete
   ```

3. Invalidate the CDN cache so visitors get the new build:

   ```bash
   aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
   ```

4. Update the Lambda only when `contact` logic changes (zip + `aws lambda
   update-function-code`, or via IaC).

Consider automating steps 1-3 in CI (GitHub Actions) on push to `main`.

## Notes / trade-offs

- **Secret safety**: `RESEND_API_KEY` never ships in the static bundle - it exists
  only inside Lambda. This is strictly safer than embedding it anywhere client-side.
- **Cost**: at portfolio traffic this is effectively free - S3 storage is pennies,
  CloudFront has a generous free tier, and Lambda's free tier easily covers a
  contact form.
- **No server to babysit**: nothing runs on a port continuously. The Lambda is
  invoked only on form submit; the rest is cached static content on the CDN edge.
- **IaC (optional but recommended)**: define S3 + CloudFront + Lambda with AWS SAM,
  CDK, or Terraform so the whole stack is reproducible instead of clicked together
  in the console.
- **`FROM` address**: still must be a Resend-verified sender (see the VPS section);
  that requirement is independent of where the code runs.

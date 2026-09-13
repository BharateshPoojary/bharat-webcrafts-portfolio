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

### Primer: registrar vs DNS host vs nameservers

Owning a domain is really TWO separate services that can live at different
companies:

| Job                     | What it does                                                        | In our case            |
| ----------------------- | ------------------------------------------------------------------ | ---------------------- |
| **Domain registration** | The yearly "rental" of the name `bharatwebcrafts.com` from ICANN    | **GoDaddy (registrar)**|
| **DNS hosting**         | The server that answers "what does `www.bharatwebcrafts.com` point to?" | GoDaddy by default - movable |

- A **nameserver** is a server that holds your DNS records (A / CNAME / MX / TXT)
  and answers lookups for your domain. They have names like `ns17.domaincontrol.com`
  (GoDaddy), `elle.ns.cloudflare.com` (Cloudflare), `ns-123.awsdns-45.com` (Route 53).
- At the registrar there is one field, **"Nameservers"**, and it is the ONLY thing
  that decides WHO hosts your DNS. It is a pointer:

  ```
  Registrar (GoDaddy) --"the nameservers are..."--> DNS host --> actual records
    owns the name                                   answers lookups   A / CNAME / MX
  ```

- **Yes, the domain and its DNS can be hosted at different companies.** That is how
  DNS is designed to work, not a hack. GoDaddy stays the registrar (you keep paying
  the yearly renewal there), while the records can live and be edited elsewhere by
  changing that Nameservers field.

This is exactly the mechanism behind the three paths below:
- **Path A** - nameservers stay GoDaddy -> edit records in GoDaddy's DNS panel.
- **Path B** - nameservers -> Route 53 -> edit records in Route 53.
- **Path C** - nameservers -> Cloudflare -> edit records in Cloudflare.

In all three, GoDaddy remains the registrar; only the DNS host changes.

**Analogy:** the registrar is the government office that says the number is legally
yours; the DNS host is the phone-book company that publishes which address that
number rings through to. You can switch phone-book companies while keeping the same
registered number - changing "Nameservers" tells the government which phone book to
trust.

**Caveat when switching nameservers:** the new DNS host does NOT automatically know
your old records. Recreate all existing records (MX for email, TXT/verification,
existing A/CNAME) at the new host before/at switch time, or things like email break
because the old GoDaddy records stop being consulted. (Cloudflare tries to
auto-import them - always verify.)

#### Migrating DNS is all-or-nothing (you cannot "add" a second nameserver)

A common misconception: "I'll just add Cloudflare as an extra nameserver and leave
GoDaddy untouched." That does not work.

- Nameserver delegation applies to the **entire zone**, not per record. When the
  registrar's Nameservers field points to Cloudflare, **100% of lookups** for the
  domain go to Cloudflare only. GoDaddy's records are no longer consulted at all.
- You **cannot mix** providers (GoDaddy NS + Cloudflare NS in the same list).
  Resolvers pick any one nameserver from the delegated set at random, and each
  provider only knows its OWN records. If a resolver asks the "wrong" provider for a
  record that only exists on the other, it gets "no such record" - so the site/email
  fail **intermittently and unpredictably**. All nameservers in the set must return
  identical answers, which only happens when they belong to the same provider.
- Therefore, to migrate you **must recreate ALL records** (A, CNAME, MX, TXT, etc.)
  at the new provider FIRST, then switch the Nameservers field. Cloudflare
  auto-imports on setup - verify MX and TXT especially, since email is what usually
  breaks.
- "GoDaddy remains untouched" is only true in the sense that its stored records
  still sit there but become **inert** (ignored). Switch the NS back and they light
  up again; nothing is deleted, it just stops being authoritative.

**The one real exception - subdomain delegation:** you can delegate a single
subdomain to another provider by adding an **NS record** for it (e.g.
`blog.bharatwebcrafts.com` -> Cloudflare) while the apex zone stays on GoDaddy. That
is per-branch delegation, not "a second nameserver for the whole domain", and is not
what a DNS migration is.

**Status:** DNS has now been migrated to **Cloudflare** (Path C) - the nameservers at
GoDaddy were switched to Cloudflare's. GoDaddy stays the registrar; all records are
managed in Cloudflare from here on. Confirm MX/TXT records carried over so email and
domain verification keep working.

5. **Custom domain + HTTPS (registered at GoDaddy, DNS on Cloudflare).**

   The domain `bharatwebcrafts.com` is registered at GoDaddy, but DNS is now hosted on
   **Cloudflare** (nameservers switched). All DNS records are added in Cloudflare.
   **Path C is the selected path** - Paths A and B below are reference only.

   Prerequisites (apply regardless of path):
   - Request an **ACM certificate in us-east-1** (CloudFront requires the cert in
     us-east-1 regardless of where other resources live). Put BOTH names on the one
     cert: `bharatwebcrafts.com` and `www.bharatwebcrafts.com`.
   - Use **DNS validation**: ACM gives you CNAME record(s). Add them in **Cloudflare
     DNS**. The cert stays "Pending validation" until those records resolve.
   - On the CloudFront distribution, set **Alternate domain names (CNAMEs)** to both
     `bharatwebcrafts.com` and `www.bharatwebcrafts.com`, and attach the ACM cert.

   ### Path A - keep DNS at GoDaddy (simplest, no migration)

   GoDaddy's DNS **cannot point the apex (`bharatwebcrafts.com`) at CloudFront**,
   because the apex needs an A/ALIAS record and GoDaddy only allows a CNAME on
   subdomains, not the apex. So serve the site on `www` and forward the apex to it.

   In GoDaddy DNS (Domains -> DNS / Manage Zones):
   - Add the ACM validation CNAME record(s) (name + value from ACM). Note: GoDaddy
     appends the domain automatically, so paste only the host part of the ACM name
     (strip the trailing `.bharatwebcrafts.com`).
   - Add a **CNAME**: host `www` -> value = the CloudFront domain
     (`dxxxx.cloudfront.net`).
   - Handle the apex with GoDaddy **Domain Forwarding**: forward
     `bharatwebcrafts.com` -> `https://www.bharatwebcrafts.com` as a **permanent
     (301)** redirect with "Forward only". This makes `https://bharatwebcrafts.com`
     land on the www site.
   - Canonical URL becomes `https://www.bharatwebcrafts.com`; the bare domain
     301-redirects to it. (GoDaddy's forwarder terminates HTTPS on the apex with its
     own cert, which is fine for a redirect.)

   ### Path B - move DNS hosting to Route 53 (NOT free)

   This gives a clean apex served directly by CloudFront (no forwarder), but Route 53
   charges **$0.50/month per hosted zone (~$6/year)** plus per-query fees. GoDaddy's
   own DNS is included with the domain for free, so only take this path if you
   specifically want Route 53 and accept the cost.
   - In Route 53, create a **public hosted zone** for `bharatwebcrafts.com`.
   - Copy the 4 **NS records** Route 53 assigns.
   - In GoDaddy (Domain settings -> Nameservers), switch to **custom nameservers**
     and paste those 4 Route 53 NS values. (Propagation can take up to ~48h.)
   - Back in Route 53, add:
     - the ACM validation CNAME record(s),
     - an **A / Alias** record for the apex `bharatwebcrafts.com` -> the CloudFront
       distribution (Alias supports the apex, which plain DNS cannot),
     - an **A / Alias** (or CNAME) for `www` -> the CloudFront distribution.
   - Now both the apex and `www` are served directly by CloudFront over HTTPS.

   ### Path C - move DNS hosting to Cloudflare (FREE, clean apex)  ** <- SELECTED (DNS already migrated) **

   This is the best of both worlds: a clean apex served by CloudFront with **no
   monthly DNS cost**. Cloudflare's DNS is free and supports **CNAME flattening at
   the apex**, which GoDaddy lacks and which is the whole reason Path A needs a
   forwarder. Registration stays at GoDaddy.
   - [DONE] Create a free Cloudflare account and add the site `bharatwebcrafts.com`;
     Cloudflare imports existing records and gives you 2 nameservers.
   - [DONE] In GoDaddy (Domain settings -> Nameservers), switch to **custom
     nameservers** and paste Cloudflare's 2 NS values. (Propagation up to ~48h.)
   - In Cloudflare DNS add:
     - the ACM validation CNAME record(s),
     - a **CNAME** for the apex `bharatwebcrafts.com` -> the CloudFront domain
       (Cloudflare flattens this to A records automatically at the apex),
     - a **CNAME** for `www` -> the CloudFront domain.
   - Set these records to **DNS only** (grey cloud, proxy OFF) so CloudFront serves
     traffic directly and terminates TLS with the ACM cert. (Leaving Cloudflare's
     orange-cloud proxy ON would put a second CDN/cert in front of CloudFront -
     avoid that here.)

   **Decision: Path C is selected** - DNS has already been migrated to Cloudflare
   (nameservers switched at GoDaddy). Registration stays at GoDaddy; all DNS records
   are now managed in Cloudflare (free), and the apex can be served directly by
   CloudFront via CNAME flattening - no forwarder needed. Paths A and B are kept
   above only as reference alternatives.

   ### Path C checklist (the selected path)

   Already done:
   - [DONE] Cloudflare account created, `bharatwebcrafts.com` added.
   - [DONE] GoDaddy nameservers switched to Cloudflare's 2 NS values.
   - Verify: existing records (especially **MX** for email and any **TXT**
     verification) were carried over into Cloudflare, or email/verification breaks.

   Remaining for the AWS custom-domain setup:
   1. ACM cert (us-east-1) covering `bharatwebcrafts.com` + `www.bharatwebcrafts.com`,
      DNS validation.
   2. In **Cloudflare DNS**, add the ACM validation CNAME(s). Cloudflare appends the
      zone automatically, so paste only the host part of the ACM name.
   3. CloudFront: set Alternate domain names to both `bharatwebcrafts.com` and
      `www.bharatwebcrafts.com`, attach the cert.
   4. In Cloudflare DNS, add a **CNAME** for the apex `bharatwebcrafts.com` -> the
      CloudFront domain (`dxxxx.cloudfront.net`); Cloudflare flattens it to A records
      at the apex.
   5. In Cloudflare DNS, add a **CNAME** for `www` -> the CloudFront domain.
   6. Set all these records to **DNS only (grey cloud, proxy OFF)** so CloudFront
      serves traffic directly and terminates TLS with the ACM cert. Leaving the
      orange-cloud proxy ON stacks a second CDN/cert in front of CloudFront - avoid.

   Result: both `https://bharatwebcrafts.com` (apex) and `https://www.bharatwebcrafts.com`
   are served directly by CloudFront over HTTPS. No GoDaddy forwarder, no monthly DNS
   cost. Pick whichever you want as canonical and 301 the other (a CloudFront
   Function or a Cloudflare redirect rule can do the apex<->www redirect).

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

---

# Manual build-out roadmap (no IaC - console/CLI by hand)

Decision: build the AWS stack **manually** (console + CLI) for learning, not with
IaC. IaC can come later once the manual flow is understood.

## Guiding principles

- **Go component by component, bottom-up.** Do NOT do "all code first" or "all infra
  first". Build one layer, verify it in isolation, then stack the next.
  Order is dictated by dependencies:
  `code split -> Lambda -> S3 -> CloudFront -> cert + DNS -> CI/CD`.
- **Test each layer via its OWN url before adding the next** - Lambda Function URL,
  then the CloudFront default domain, then the custom domain last. If something
  breaks you know exactly which phase caused it.
- **Keep the current working setup alive** (local / VPS node) until AWS is fully
  validated. Build AWS in parallel and cut DNS over only at the very end - never sit
  in a broken state.
- Use an **IAM user/role** for daily work, not the root account. Pick one region for
  S3 + Lambda (e.g. `ap-south-1`); the ACM cert MUST be in **us-east-1**.

## Phase 0 - Decide & prep

- [ ] Confirm AWS account, working region, and that cert goes in us-east-1.
- [ ] Have `RESEND_API_KEY` ready.
- [ ] Create/verify an IAM user or role for yourself (not root); log in with it.

## Phase 1 - Code changes (must come first; infra needs the artifacts)

- [ ] Extract the contact logic from `src/pages/api/contact.ts` into a standalone
      **Lambda handler** (same Resend call, Lambda signature).
- [ ] Switch `astro.config.mjs` to **pure static** (remove node adapter + env schema).
- [ ] `bun run build` and verify `dist/` has static files only (no `dist/server/`).
- [ ] Verify the Lambda handler runs/tests locally.
- Checkpoint: you have a static `dist/` and a zippable Lambda handler; nothing on AWS.

## Phase 2 - Lambda (dynamic piece, isolated)

- [ ] Create an IAM **execution role** for the Lambda (basic logging perms).
- [ ] Create the **Lambda function**, upload the handler, set `RESEND_API_KEY` env var.
- [ ] Enable the **Function URL** (auth `NONE` for now).
- [ ] `curl` the Function URL with a fake contact payload; confirm the email arrives.
- Checkpoint: contact backend works standalone, before any CDN.

## Phase 3 - S3 (static piece, isolated)

- [ ] Create a **private** bucket (block ALL public access; do NOT enable S3 website
      hosting).
- [ ] Upload `dist/` (cache headers come later in Phase 6).
- Checkpoint: files in S3, bucket private (verified via CloudFront next, not directly).

## Phase 4 - CloudFront (glue tying S3 + Lambda together)

- [ ] Create distribution with **Origin A = S3 via OAC** (paste the generated bucket
      policy).
- [ ] Set **default root object** = `index.html`.
- [ ] Test the CloudFront default domain (`dxxxx.cloudfront.net`) - static site loads.
- [ ] Add **Origin B = Lambda Function URL** + behavior **`/api/*`** -> Lambda,
      caching disabled, POST allowed, forward body + `Content-Type`.
- [ ] Test `https://dxxxx.cloudfront.net/api/contact` - form works same-origin.
- Checkpoint: full site AND contact form work on the CloudFront URL, no custom domain.

## Phase 5 - Custom domain + HTTPS (DNS on Cloudflare)

- [ ] Request **ACM cert in us-east-1** for apex + `www`; add validation CNAMEs in
      Cloudflare DNS (grey cloud).
- [ ] Add both domains as CloudFront **Alternate domain names**; attach the cert.
- [ ] In Cloudflare, point apex + `www` at the CloudFront domain (**DNS only / grey
      cloud**).
- [ ] Test `https://bharatwebcrafts.com` end to end.
- Checkpoint: real domain serves site + form over HTTPS.

## Phase 6 - Cut over & caching

- [ ] Decommission the old VPS/node deployment once AWS is validated.
- [ ] Apply the cache-header strategy: immutable/long cache for hashed `_astro/*`
      assets, `no-cache` for HTML.
- [ ] Do a **manual CloudFront invalidation** once, by hand, to understand it before
      automating.

## Phase 7 - CI/CD (only after manual works)

- [ ] Wrap the proven manual steps into a pipeline (build -> S3 sync with headers ->
      invalidate -> optional Lambda update).
- [ ] Use **GitHub OIDC** to assume an IAM role (no long-lived access keys).
- [ ] Path-filter jobs so site-only changes skip the Lambda deploy.

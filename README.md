# Portfolio

Personal portfolio site built with [Astro](https://astro.build), deployed as a static site on AWS with a serverless contact form.

Live at **[bharatwebcrafts.com](https://bharatwebcrafts.com)**.

## 🏗️ Architecture

| Piece | Service | Notes |
| ----- | ------- | ----- |
| Static site | **S3** (`bharatwebcrafts-site`) | Build output (`dist/`) synced here |
| CDN / edge | **CloudFront** (`EUJI73Y1I8GVF`) | Fronts both the S3 bucket and the contact Lambda |
| Contact form | **Lambda** (`contact-form`) via Function URL | Routed through CloudFront at `/api/contact` |
| Email delivery | **Resend** | Called from inside the Lambda |
| Region | `ap-south-1` | |

All AWS resources (S3 bucket, CloudFront distribution, Lambda function, IAM OIDC role) were **created manually via the AWS Console** — there's no CLI/IaC provisioning step in this repo; the pipeline only *deploys code* to resources that already exist.

```
              ┌───────────────┐
   Users ───▶ │  CloudFront   │  (EUJI73Y1I8GVF)
              └──────┬────────┘
                      │
         ┌────────────┼──────────────────┐
         ▼                                ▼
   ┌────────────────┐             ┌──────────────────┐
   │ S3              │             │ Lambda            │
   │ bharatwebcrafts- │             │ contact-form       │
   │ site (static)    │             │ (Function URL,     │
   │                  │             │  /api/contact)     │
   └─────────────────┘             └─────────┬──────────┘
                                              │
                                              ▼
                                         Resend API
                                       (email delivery)
```

## 🚀 Project Structure

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
├── lambda/
│   └── contact/          # Contact form Lambda (Node, packaged & zipped in CI)
│       ├── index.mjs
│       └── package.json
├── .github/
│   └── workflows/
│       └── ci-cd.yml     # Build + deploy pipeline
└── package.json
```

## 🛠️ Tech Stack

- **Framework:** Astro
- **Package manager:** Bun
- **Hosting:** AWS S3 (static) + CloudFront (CDN)
- **Backend:** AWS Lambda (Function URL) for the contact form
- **Email:** Resend
- **CI/CD:** GitHub Actions, authenticating to AWS via OIDC (no long-lived AWS keys)

## 🧞 Commands

| Command                | Action                                           |
| :---------------------- | :----------------------------------------------- |
| `bun install`            | Installs dependencies                            |
| `bun dev`                | Starts local dev server at `localhost:4321`      |
| `bun build`              | Build your production site to `./dist/`          |
| `bun preview`            | Preview your build locally, before deploying     |
| `bun astro ...`          | Run CLI commands like `astro add`, `astro check` |
| `bun astro -- --help`    | Get help using the Astro CLI                     |

## 🔑 Local Development

The contact form calls [Resend](https://resend.com) to send email. To test it locally:

1. Get an API key from your Resend dashboard.
2. Set it as `RESEND_API_KEY` in your local environment (e.g. `lambda/contact/.env`, not committed).
3. In production, `RESEND_API_KEY` is set directly as a **Lambda environment variable** in the console — it is never baked into the deployed zip or the static build.

## ☁️ CI/CD Pipeline

Defined in [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml). Triggers on push to `main` and via manual `workflow_dispatch`.

**1. Detect changes** — `dorny/paths-filter` checks whether the push touched site files (`src/`, `public/`, `astro.config.mjs`, etc.) or `lambda/**`, so a site-only change doesn't redeploy the Lambda and vice versa. A manual run always deploys both.

**2. `deploy-site`** (runs if site files changed, or on manual dispatch)
- Install deps with Bun, `bun run build`
- Authenticate to AWS via **OIDC** (`aws-actions/configure-aws-credentials`, assuming `secrets.AWS_DEPLOY_ROLE_ARN`)
- Two-pass S3 sync:
  - Pass 1 — hashed assets in `dist/_astro/`: `--cache-control "public, max-age=31536000, immutable"` (filenames change on every build, so these can be cached forever)
  - Pass 2 — everything else (HTML, `public/` assets): `--cache-control "no-cache"`, excluding `_astro/*` so pass 1's objects aren't touched
- Invalidate CloudFront (`/*`) so the no-cache files refresh at the edge

**3. `deploy-lambda`** (runs if `lambda/**` changed, or on manual dispatch)
- Install production deps in `lambda/contact`, zip `index.mjs` + `package.json` + `node_modules`
- Authenticate via OIDC (same role)
- `aws lambda update-function-code` to push the new zip

There's also a temporary **`debug-oidc-token`** job that decodes and prints the OIDC token's claims (`sub`, `aud`, `iss`, `repository`, `ref`) to verify the trust policy is matching correctly — remove it once the OIDC handshake is confirmed working.

### Required GitHub Secret

| Name | Description |
| ---- | ----------- |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN assumed via GitHub OIDC. Trust policy scoped to this repo's OIDC subject. Needs `s3:PutObject`/`DeleteObject`/`ListBucket` on `bharatwebcrafts-site`, `cloudfront:CreateInvalidation` on `EUJI73Y1I8GVF`, and `lambda:UpdateFunctionCode` on `contact-form`. |

### Workflow env values (edit in `ci-cd.yml` if resources change)

```yaml
AWS_REGION: ap-south-1
S3_BUCKET: bharatwebcrafts-site
CLOUDFRONT_DISTRIBUTION_ID: EUJI73Y1I8GVF
LAMBDA_FUNCTION_NAME: contact-form
```


## 👀 Learn More

- [Astro Documentation](https://docs.astro.build)
- [AWS Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html)
- [Resend Documentation](https://resend.com/docs)
- [GitHub Actions OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
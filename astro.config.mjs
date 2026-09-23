// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  // Canonical origin. Drives the generated sitemap, robots.txt, and Astro.site
  // so the layout can emit absolute canonical / Open Graph URLs.
  site: "https://bharatwebcrafts.com",

  // Fully static: `astro build` emits only dist/ (no dist/server/). The one
  // dynamic route (contact form) now lives in a standalone Lambda - see
  // lambda/contact/ - fronted by CloudFront at /api/contact. The RESEND_API_KEY
  // secret lives only in Lambda, never in this build.
  output: "static",

  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },
});

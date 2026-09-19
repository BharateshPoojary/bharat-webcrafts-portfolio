// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  // Fully static: `astro build` emits only dist/ (no dist/server/). The one
  // dynamic route (contact form) now lives in a standalone Lambda - see
  // lambda/contact/ - fronted by CloudFront at /api/contact. The RESEND_API_KEY
  // secret lives only in Lambda, never in this build.
  output: "static",

  vite: {
    plugins: [tailwindcss()],
  },
});

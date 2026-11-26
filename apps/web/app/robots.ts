import type { MetadataRoute } from "next";

// Lets crawlers and link-preview bots in. Pages that shouldn't be in search say noindex
// themselves, which bots can only read if this file doesn't block them.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}

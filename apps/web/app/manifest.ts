import type { MetadataRoute } from "next";

// Makes the site installable to the home screen (ALL-20). No service worker:
// browsers no longer need one to install, and push (ALL-40) would add it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GiftMe",
    short_name: "GiftMe",
    description: "The right gift, on time, without the scramble.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

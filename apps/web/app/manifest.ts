import type { MetadataRoute } from "next";

/** PWA / install manifest. Helps mobile add-to-home-screen and SEO signals. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Skimflow",
    short_name: "Skimflow",
    description: "Pay-per-block reading for people and AI agents — articles, books, and picture stories in USDC.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBF9F3",
    theme_color: "#99411e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

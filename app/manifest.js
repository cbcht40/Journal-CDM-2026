export default function manifest() {
  return {
    name: "Journal CDM 2026",
    short_name: "CDM 2026",
    description: "Carnet de paris entre amis — Coupe du monde 2026",
    start_url: "/",
    display: "standalone",
    background_color: "#F1F2EC",
    theme_color: "#0E5A3C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

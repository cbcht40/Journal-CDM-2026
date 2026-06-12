import "./globals.css";

export const metadata = {
  title: "Journal CDM 2026",
  description: "Carnet de paris entre amis — Coupe du monde 2026",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CDM 2026",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E5A3C",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

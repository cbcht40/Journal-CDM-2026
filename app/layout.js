import "./globals.css";

export const metadata = {
  title: "Journal CDM 2026",
  description: "Carnet de paris entre amis — Coupe du monde 2026",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { El_Messiri, Montserrat } from "next/font/google";
import "./globals.css";

// Brand fonts of ganjaparkcity.az, used by the apartment modal.
const gpcSans = Montserrat({ subsets: ["latin", "latin-ext"], weight: ["300", "400", "500", "600", "700"], variable: "--font-gpc-sans" });
const gpcHead = El_Messiri({ subsets: ["latin", "latin-ext"], weight: ["600", "700"], variable: "--font-gpc-head" });

export const metadata: Metadata = {
  title: "Apartment Viewer",
  description: "Yeni Gəncə residential complex – interactive 3D apartment viewer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az" className={`${gpcSans.variable} ${gpcHead.variable}`}>
      <body>{children}</body>
    </html>
  );
}

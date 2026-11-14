import type { Metadata } from "next";
import { Inter, Noto_Serif_SC } from "next/font/google";
import "../globals.css";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { Providers } from "@/components/Providers";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { I18nProvider } from "@/lib/i18n/I18nContext";
import { ThemeProvider } from "@/lib/theme/ThemeContext";
import AuthLayoutWrapper from "@/lib/auth/AuthLayoutWrapper";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://real-estate-agency-crm.vercel.app";

// Platform name: pending the owner's choice (spec, open question 1). Brokerage sites get their own metadata (phase F5).
const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || "Plataforma inmobiliaria";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${PLATFORM_NAME}: sitio web y gestión para inmobiliarias`,
    template: `%s | ${PLATFORM_NAME}`,
  },
  description:
    "Plataforma para inmobiliarias de Uruguay: sitio web con mapa y filtros, CRM de interesados, visitas, documentos y gestión de alquileres, en un solo lugar.",
  keywords: [
    "software inmobiliario Uruguay",
    "CRM inmobiliario",
    "sitio web para inmobiliarias",
    "gestión de alquileres",
    "propiedades en venta y alquiler",
  ],
  authors: [{ name: PLATFORM_NAME, url: SITE_URL }],
  creator: PLATFORM_NAME,
  publisher: PLATFORM_NAME,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    locale: "es_UY",
    alternateLocale: ["en_US"],
    url: SITE_URL,
    siteName: PLATFORM_NAME,
    title: `${PLATFORM_NAME}: tu inmobiliaria, en orden`,
    description:
      "Sitio web, interesados, visitas y alquileres para inmobiliarias de Uruguay.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: PLATFORM_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PLATFORM_NAME,
    description:
      "Sitio web, interesados, visitas y alquileres para inmobiliarias de Uruguay.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: PLATFORM_NAME,
  },
  formatDetection: { telephone: false },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "application-name": PLATFORM_NAME,
    "msapplication-TileColor": "#B8977E",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-UY" data-theme="luxury" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${notoSerifSC.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>
            <I18nProvider>
              <Providers>
                <AuthLayoutWrapper>{children}</AuthLayoutWrapper>
              </Providers>
            </I18nProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

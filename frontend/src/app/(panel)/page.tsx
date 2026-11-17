import type { Metadata } from 'next';
import LandingPageClient from '@/components/landing/LandingPageClient';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://real-estate-agency-crm.vercel.app';

export const metadata: Metadata = {
  title: 'Real Estate Brokerage CRM — Manage Clients, Listings & Commissions',
  description:
    'The all-in-one CRM platform for real estate agents and brokerages. Manage clients, track listings, close deals faster, and automate commission splits.',
  keywords: [
    'real estate CRM',
    'brokerage management software',
    'real estate agent software',
    'property listing management',
    'commission tracking',
    'real estate pipeline',
    'luxury real estate software',
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: 'Real Estate Brokerage CRM — Close More Deals',
    description:
      'All-in-one platform for real estate agents: clients, listings, deals, commissions & AI marketing.',
    url: SITE_URL,
    siteName: 'Real Estate CRM',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Real Estate CRM Dashboard Preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Real Estate Brokerage CRM',
    description: 'Manage clients, listings & commissions in one platform.',
    images: [`${SITE_URL}/og-image.png`],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Real Estate CRM',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Professional CRM platform for real estate agents and brokerages. Manage clients, listings, transactions, commissions, and AI-powered marketing.',
  url: SITE_URL,
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'USD',
    lowPrice: '0',
    offerCount: '3',
    offers: [
      { '@type': 'Offer', name: 'Core', price: '0', priceCurrency: 'USD' },
      { '@type': 'Offer', name: 'Pro', price: '39', priceCurrency: 'USD' },
      { '@type': 'Offer', name: 'Elite', price: '79', priceCurrency: 'USD' },
    ],
  },
  featureList: [
    'Client & Lead Management (CRM)',
    'Property Listing Management',
    'Deal Pipeline & Transaction Tracking',
    'Commission Calculation & Splits',
    'AI-Powered Marketing Content',
    'Appointment Scheduling & Calendar',
    'Document Management',
    'Team Collaboration & Invite',
    'Reports & Analytics',
    '4-Language Support (EN / 中文简 / 中文繁 / ES)',
  ],
  publisher: {
    '@type': 'Organization',
    name: 'Real Estate CRM',
    url: SITE_URL,
  },
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPageClient />
    </>
  );
}

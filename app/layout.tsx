import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Issue Englisher - GitHub Issue Translator',
    template: '%s | Issue Englisher',
  },
  description: 'Translate Chinese/mixed language bug reports to standard English GitHub Issues. Professional issue formatting, sensitive data redaction, watermark control, and usage limits.',
  keywords: ['GitHub', 'Issue', 'translator', 'bug report', 'English', 'developer tool', 'issue formatter'],
  authors: [{ name: 'Issue Englisher Team' }],
  creator: 'Issue Englisher',
  publisher: 'Issue Englisher',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Issue Englisher - GitHub Issue Translator',
    description: 'Translate Chinese bug reports to professional English GitHub Issues with proper formatting',
    type: 'website',
    url: 'https://issue-englisher.vercel.app',
    siteName: 'Issue Englisher',
    images: [
      {
        url: 'https://issue-englisher.vercel.app/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Issue Englisher - GitHub Issue Translator',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Issue Englisher',
    description: 'Translate Chinese bug reports to professional English GitHub Issues',
    images: ['https://issue-englisher.vercel.app/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://issue-englisher.vercel.app',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-100">
        {children}
      </body>
    </html>
  )
}

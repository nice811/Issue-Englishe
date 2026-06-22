import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Issue Englisher - GitHub Issue Translator',
  description: 'Translate Chinese/mixed language bug reports to standard English GitHub Issues',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100">
        {children}
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://issue-englisher.vercel.app'),
  title: {
    default: 'Issue Englisher - 中文转英文 GitHub Issue 生成器',
    template: '%s | Issue Englisher',
  },
  description: '将中文 Bug 报告一键转换为标准英文 GitHub Issue。内置防驳回校验、敏感数据脱敏、AI 智能扩充，专为中国开发者设计。',
  keywords: [
    'GitHub Issue',
    'Issue translator',
    'bug report',
    '英文 Issue',
    'developer tool',
    'issue formatter',
    'DeepSeek',
    'AI 翻译',
    'GitHub 翻译',
    '中文转英文',
    '防驳回',
    '敏感数据脱敏',
  ],
  authors: [{ name: 'Issue Englisher Team' }],
  creator: 'Issue Englisher',
  publisher: 'Issue Englisher',
  category: 'developer tools',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  applicationName: 'Issue Englisher',
  openGraph: {
    title: 'Issue Englisher - 中文转英文 GitHub Issue 生成器',
    description: '将中文 Bug 报告一键转换为标准英文 GitHub Issue。内置防驳回校验、敏感数据脱敏、AI 智能扩充。',
    type: 'website',
    url: 'https://issue-englisher.vercel.app',
    siteName: 'Issue Englisher',
    locale: 'zh_CN',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Issue Englisher - 中文转英文 GitHub Issue 生成器',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Issue Englisher',
    description: '中文 Bug 报告 → 标准英文 GitHub Issue，一键生成',
    images: ['/api/og'],
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

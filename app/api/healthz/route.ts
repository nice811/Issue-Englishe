import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  })
}
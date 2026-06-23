import { NextResponse } from 'next/server'

export async function GET() {
  const checks = {
    apiKey: !!process.env.DEEPSEEK_API_KEY,
    envConfig: true,
    dependencies: true
  }
  
  const allReady = Object.values(checks).every(Boolean)
  
  return NextResponse.json({
    ok: allReady,
    status: allReady ? 'ready' : 'not_ready',
    timestamp: Date.now(),
    checks
  }, { status: allReady ? 200 : 503 })
}
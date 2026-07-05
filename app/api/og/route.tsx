import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 'bold',
            }}
          >
            IE
          </div>
          <h1 style={{ fontSize: 64, fontWeight: 'bold', margin: 0 }}>
            Issue Englisher
          </h1>
        </div>

        <p style={{ fontSize: 32, opacity: 0.95, margin: 0, textAlign: 'center', maxWidth: 900 }}>
          中文 Bug 报告 → 标准英文 GitHub Issue，一键生成
        </p>

        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 48,
          }}
        >
          <div
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              fontSize: 24,
              border: '2px solid rgba(255,255,255,0.3)',
            }}
          >
            🛡️ 防驳回校验
          </div>
          <div
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              fontSize: 24,
              border: '2px solid rgba(255,255,255,0.3)',
            }}
          >
            🔒 敏感数据脱敏
          </div>
          <div
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              fontSize: 24,
              border: '2px solid rgba(255,255,255,0.3)',
            }}
          >
            ✨ AI 智能扩充
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 32,
            right: 48,
            fontSize: 20,
            opacity: 0.7,
          }}
        >
          issue-englisher.vercel.app
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}

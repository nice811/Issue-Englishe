'use client'

import { useState, useEffect, useCallback } from 'react'
import { Language, getBrowserLanguage, getText } from '../../i18n'

interface TokenInfo {
  token: string
  plan: string
  expiresAt: number
  devHash?: string
  createdAt: number
}

interface RevokedToken {
  token: string
  reason: string
  revokedAt: number
  revokedBy: string
}

export default function AdminPage() {
  const [lang, setLang] = useState<Language>('zh')
  const [apiKey, setApiKey] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const [tokenPlan, setTokenPlan] = useState<'pro' | 'enterprise'>('pro')
  const [tokenDays, setTokenDays] = useState(30)
  const [newToken, setNewToken] = useState('')
  const [generatedAt, setGeneratedAt] = useState(0)
  
  const [verifyToken, setVerifyToken] = useState('')
  const [verifyResult, setVerifyResult] = useState<TokenInfo | null>(null)
  const [verifyError, setVerifyError] = useState('')
  
  const [revokeToken, setRevokeToken] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [revokedList, setRevokedList] = useState<RevokedToken[]>([])

  useEffect(() => {
    setLang(getBrowserLanguage())
  }, [])

  const t = (key: string, params?: Record<string, string | number>) => getText(lang, key, params)

  const handleLogin = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('请输入管理员密钥')
      return
    }
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/admin/verify-token', {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'x-admin-key': apiKey
        },
        body: JSON.stringify({ token: 'test' })
      })
      if (resp.ok) {
        setAuthenticated(true)
        localStorage.setItem('admin-key', apiKey)
      } else {
        setError('管理员密钥无效')
      }
    } catch {
      setError('连接失败')
    } finally {
      setLoading(false)
    }
  }, [apiKey])

  useEffect(() => {
    const saved = localStorage.getItem('admin-key')
    if (saved) {
      setApiKey(saved)
      handleLogin()
    }
  }, [handleLogin])

  const generateToken = useCallback(async () => {
    setLoading(true)
    setError('')
    setNewToken('')
    try {
      const resp = await fetch('/api/admin/generate-token', {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'x-admin-key': apiKey
        },
        body: JSON.stringify({ plan: tokenPlan, days: tokenDays })
      })
      const data = await resp.json()
      if (resp.ok) {
        setNewToken(data.token)
        setGeneratedAt(Date.now())
      } else {
        setError(data.error || '生成失败')
      }
    } catch {
      setError('连接失败')
    } finally {
      setLoading(false)
    }
  }, [apiKey, tokenPlan, tokenDays])

  const doVerifyToken = useCallback(async () => {
    if (!verifyToken.trim()) return
    setVerifyError('')
    setVerifyResult(null)
    try {
      const resp = await fetch('/api/admin/verify-token', {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'x-admin-key': apiKey
        },
        body: JSON.stringify({ token: verifyToken })
      })
      const data = await resp.json()
      if (resp.ok) {
        setVerifyResult(data)
      } else {
        setVerifyError(data.error || '验证失败')
      }
    } catch {
      setVerifyError('连接失败')
    }
  }, [apiKey, verifyToken])

  const doRevokeToken = useCallback(async () => {
    if (!revokeToken.trim()) return
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/admin/revoke-token', {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'x-admin-key': apiKey
        },
        body: JSON.stringify({ token: revokeToken, reason: revokeReason || '手动吊销' })
      })
      const data = await resp.json()
      if (resp.ok) {
        alert('吊销成功')
        setRevokeToken('')
        setRevokeReason('')
      } else {
        setError(data.error || '吊销失败')
      }
    } catch {
      setError('连接失败')
    } finally {
      setLoading(false)
    }
  }, [apiKey, revokeToken, revokeReason])

  const loadRevokedTokens = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/revoke-token', {
        method: 'GET',
        headers: { 'x-admin-key': apiKey }
      })
      const data = await resp.json()
      if (resp.ok) {
        setRevokedList(data)
      }
    } catch {
      console.error('Failed to load revoked tokens')
    }
  }, [apiKey])

  useEffect(() => {
    if (authenticated) {
      loadRevokedTokens()
    }
  }, [authenticated, loadRevokedTokens])

  const restoreToken = useCallback(async (token: string) => {
    try {
      const resp = await fetch('/api/admin/revoke-token', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'x-admin-key': apiKey
        },
        body: JSON.stringify({ token })
      })
      if (resp.ok) {
        alert('恢复成功')
        loadRevokedTokens()
      } else {
        const data = await resp.json()
        alert(data.error || '恢复失败')
      }
    } catch {
      alert('连接失败')
    }
  }, [apiKey, loadRevokedTokens])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert('已复制到剪贴板')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      alert('已复制到剪贴板')
    }
  }, [])

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              AD
            </div>
            <h1 className="text-xl font-bold text-slate-800">管理员登录</h1>
            <p className="text-sm text-slate-500 mt-1">请输入管理员密钥</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">管理员密钥</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 ADMIN_API_KEY"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-white font-bold">
              AD
            </div>
            <div>
              <h1 className="text-lg font-semibold">Issue Englisher 管理后台</h1>
              <p className="text-xs text-slate-500">Pro 令牌管理</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setLang('zh')}
                className={`px-3 py-1 text-sm rounded-md transition-all ${lang === 'zh' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              >
                中文
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-3 py-1 text-sm rounded-md transition-all ${lang === 'en' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              >
                EN
              </button>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('admin-key')
                setAuthenticated(false)
                setApiKey('')
              }}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">生成 Pro 令牌</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">套餐类型</label>
                    <select
                      value={tokenPlan}
                      onChange={(e) => setTokenPlan(e.target.value as 'pro' | 'enterprise')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="pro">Pro 版</option>
                      <option value="enterprise">Enterprise 版</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">有效期（天）</label>
                    <input
                      type="number"
                      value={tokenDays}
                      onChange={(e) => setTokenDays(Math.max(1, parseInt(e.target.value) || 30))}
                      min="1"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <button
                  onClick={generateToken}
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition"
                >
                  {loading ? '生成中...' : '生成令牌'}
                </button>
                {newToken && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-indigo-700">生成的令牌</span>
                      <button
                        onClick={() => copyToClipboard(newToken)}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        复制
                      </button>
                    </div>
                    <code className="block text-sm font-mono text-indigo-900 break-all">{newToken}</code>
                    <p className="text-xs text-indigo-600 mt-2">有效期至：{new Date(generatedAt + tokenDays * 24 * 60 * 60 * 1000).toLocaleDateString()}</p>
                  </div>
                )}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">验证令牌</h2>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">令牌</label>
                  <input
                    type="password"
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    placeholder="输入要验证的令牌"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={doVerifyToken}
                  disabled={loading}
                  className="w-full bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition"
                >
                  验证
                </button>
                {verifyError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {verifyError}
                  </div>
                )}
                {verifyResult && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-emerald-800">套餐类型</span>
                        <span className="font-medium text-emerald-900">
                          {verifyResult.plan === 'pro' ? 'Pro' : 'Enterprise'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800">创建时间</span>
                        <span className="font-medium text-emerald-900">
                          {new Date(verifyResult.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800">过期时间</span>
                        <span className={`font-medium ${verifyResult.expiresAt < Date.now() ? 'text-red-600' : 'text-emerald-900'}`}>
                          {new Date(verifyResult.expiresAt).toLocaleString()}
                        </span>
                      </div>
                      {verifyResult.devHash && (
                        <div className="flex justify-between">
                          <span className="text-emerald-800">绑定设备</span>
                          <span className="font-mono text-sm text-emerald-900">{verifyResult.devHash}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">吊销令牌</h2>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">令牌</label>
                  <input
                    type="password"
                    value={revokeToken}
                    onChange={(e) => setRevokeToken(e.target.value)}
                    placeholder="输入要吊销的令牌"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">吊销原因（可选）</label>
                  <input
                    type="text"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="如：用户退款"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={doRevokeToken}
                  disabled={loading}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition"
                >
                  吊销
                </button>
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">已吊销列表</h2>
              </div>
              <div className="p-5">
                {revokedList.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <p className="text-sm">暂无吊销记录</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {revokedList.map((item, index) => (
                      <div key={index} className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-red-700">已吊销</span>
                          <button
                            onClick={() => restoreToken(item.token)}
                            className="text-xs text-green-600 hover:text-green-700 font-medium"
                          >
                            恢复
                          </button>
                        </div>
                        <code className="block text-xs font-mono text-red-900 break-all">{item.token}</code>
                        <p className="text-xs text-red-600 mt-1">{item.reason}</p>
                        <p className="text-xs text-red-500 mt-0.5">{new Date(item.revokedAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
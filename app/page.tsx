'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import DOMPurify from 'dompurify'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Language, getBrowserLanguage, getText } from '../i18n'

// ============ 类型定义 ============
interface EnvData {
  os?: string
  appVersion?: string
  deps?: string
  logs?: string
}

interface OptionsData {
  spelling: 'us' | 'uk'
  suggestLabels: boolean
  // watermark intentionally removed — decided server-side only
}

interface FormState {
  title: string
  description: string
  steps: string[]
  expected: string
  actual: string
  env: Required<EnvData>
  options: OptionsData
  token: string
}

interface GenerateResponse {
  markdown: string
  watermark: boolean
  labels: string[]
  usage: { countToday: number; limit: number }
  cost: { tokens: number; ms: number }
}

interface ErrorResponse {
  error: string
  details?: string[]
}

// ============ 初始状态 ============
const initialState: FormState = {
  title: '',
  description: '',
  steps: [''],
  expected: '',
  actual: '',
  env: { os: '', appVersion: '', deps: '', logs: '' },
  options: {
    spelling: 'us',
    suggestLabels: true
  },
  token: ''
}

// ============ 工具函数 ============
function getDateSuffix(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function downloadBlob(filename: string, content: string, type = 'text/markdown'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============ 主组件 ============
export default function Home() {
  const [lang, setLang] = useState<Language>('zh')
  const [form, setForm] = useState<FormState>(initialState)
  const [markdown, setMarkdown] = useState<string>('')
  const [labels, setLabels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [usage, setUsage] = useState<{ countToday: number; limit: number } | null>(null)
  const [watermark, setWatermark] = useState<boolean | null>(null) // read-only from server

  // 初始化语言
  useEffect(() => {
    setLang(getBrowserLanguage())
  }, [])

  // 翻译函数
  const t = useCallback((key: string) => getText(lang, key), [lang])

  // ============ 更新函数 ============
  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setError('')
  }, [])

  const updateEnv = useCallback(<K extends keyof EnvData>(key: K, value: string) => {
    setForm(prev => ({
      ...prev,
      env: { ...prev.env, [key]: value }
    }))
    setError('')
  }, [])

  const updateOptions = useCallback(<K extends keyof OptionsData>(key: K, value: OptionsData[K]) => {
    setForm(prev => ({
      ...prev,
      options: { ...prev.options, [key]: value }
    }))
  }, [])

  const addStep = useCallback(() => {
    setForm(prev => ({ ...prev, steps: [...prev.steps, ''] }))
  }, [])

  const updateStep = useCallback((index: number, value: string) => {
    setForm(prev => {
      const newSteps = [...prev.steps]
      newSteps[index] = value
      return { ...prev, steps: newSteps }
    })
  }, [])

  const removeStep = useCallback((index: number) => {
    setForm(prev => {
      if (prev.steps.length <= 1) return prev
      return { ...prev, steps: prev.steps.filter((_, i) => i !== index) }
    })
  }, [])

  // ============ 提交 ============
  const submit = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          steps: form.steps.filter(s => s.trim().length > 0),
          env: {
            ...form.env,
            deps: form.env.deps
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          },
          client: { ipHash: '', fingerprint: '' }
        })
      })

      const data = (await resp.json()) as GenerateResponse | ErrorResponse

      if (!resp.ok) {
        const errData = data as ErrorResponse
        const message =
          (errData.details && errData.details.length > 0)
            ? `${errData.error}: ${errData.details.join(' ')}`
            : errData.error

        if (resp.status === 402) {
          throw new Error(`Limit reached. ${message}`)
        }
        if (resp.status === 429) {
          throw new Error(`Rate limited. ${message}`)
        }
        throw new Error(message || 'Request failed.')
      }

      const success = data as GenerateResponse
      setMarkdown(success.markdown)
      setLabels(success.labels)
      setUsage(success.usage)
      setWatermark(success.watermark) // read-only from server
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [form])

  // ============ 复制 & 下载 ============
  const copyToClipboard = useCallback(async () => {
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      alert('Copied to clipboard.')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = markdown
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      alert('Copied to clipboard.')
    }
  }, [markdown])

  const downloadMd = useCallback(() => {
    if (!markdown) return
    const filename = `issue-${getDateSuffix(new Date())}.md`
    downloadBlob(filename, markdown)
  }, [markdown])

  // ============ 键盘快捷键 ============
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'enter') {
        e.preventDefault()
        submit()
      }
    },
    [submit]
  )

  // ============ 派生显示数据 ============
  const remaining = usage ? usage.limit - usage.countToday : null
  const isProUser = useMemo(() => form.token.trim().length > 0, [form.token])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" onKeyDown={onKeyDown}>
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-white font-bold">
              IE
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Issue Englisher</h1>
              <p className="text-xs text-slate-500">{t('common.noDataStored')}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {/* 语言切换器 */}
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
            {remaining !== null && (
              <span className={`px-3 py-1.5 rounded-full font-medium ${
                remaining <= 1 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {remaining} {t('common.usesRemaining')}
              </span>
            )}
            <a href="#upgrade" className="text-indigo-600 hover:text-indigo-700 font-medium">{t('common.upgrade')}</a>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Form */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                {t('form.title')} {t('common.required')}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {isProUser ? 'Pro 版 — 已去水印、更高额度' : '免费版 — 附水印、10 次/天'}
              </p>
            </div>

            <div className="p-5 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('form.title')} <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder={t('form.titlePlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  maxLength={120}
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>{t('form.titleHint')}</span>
                  <span>{form.title.length}/120</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('form.description')} <span className="text-red-500">*</span></label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder={t('form.descriptionPlaceholder')}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
                <p className="text-xs text-slate-400 mt-1 text-right">{form.description.length} chars</p>
              </div>

              {/* Steps */}
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('form.steps')}</label>
                <div className="space-y-2">
                  {form.steps.map((step, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-mono w-6 text-right">{index + 1}.</span>
                      <input
                        type="text"
                        value={step}
                        onChange={(e) => updateStep(index, e.target.value)}
                        placeholder={t('form.stepPlaceholder')}
                        className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      {form.steps.length > 1 && (
                        <button
                          onClick={() => removeStep(index)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                          aria-label="Remove step"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={addStep}
                  className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  {t('form.addStep')}
                </button>
              </div>

              {/* Expected + Actual */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">{t('form.expected')} <span className="text-red-500">*</span></label>
                  <textarea
                    value={form.expected}
                    onChange={(e) => updateField('expected', e.target.value)}
                    placeholder={t('form.expectedPlaceholder')}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">{t('form.actual')} <span className="text-red-500">*</span></label>
                  <textarea
                    value={form.actual}
                    onChange={(e) => updateField('actual', e.target.value)}
                    placeholder={t('form.actualPlaceholder')}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>

              {/* Environment */}
              <div className="border-t border-slate-100 pt-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('form.environment')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">{t('form.os')}</label>
                    <input
                      type="text"
                      value={form.env.os}
                      onChange={(e) => updateEnv('os', e.target.value)}
                      placeholder={t('form.osPlaceholder')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">{t('form.appVersion')}</label>
                    <input
                      type="text"
                      value={form.env.appVersion}
                      onChange={(e) => updateEnv('appVersion', e.target.value)}
                      placeholder={t('form.versionPlaceholder')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-600 mb-1">{t('form.dependencies')}</label>
                  <input
                    type="text"
                    value={form.env.deps}
                    onChange={(e) => updateEnv('deps', e.target.value)}
                    placeholder={t('form.depsPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-600 mb-1">{t('form.logs')}</label>
                  <textarea
                    value={form.env.logs}
                    onChange={(e) => updateEnv('logs', e.target.value)}
                    placeholder={t('form.logsPlaceholder')}
                    rows={4}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-right">{form.env.logs.length}/2000 · {t('form.logsHint')}</p>
                </div>
              </div>

              {/* Options */}
              <div className="border-t border-slate-100 pt-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('form.options')}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1.5">{t('form.spelling')}</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateOptions('spelling', 'us')}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                          form.options.spelling === 'us'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {t('common.usSpelling')}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateOptions('spelling', 'uk')}
                        disabled={!isProUser}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                          form.options.spelling === 'uk'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        } ${!isProUser ? 'opacity-60 cursor-not-allowed' : ''}`}
                        title={isProUser ? '' : 'British spelling — Pro only'}
                      >
                        {t('common.ukSpelling')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.options.suggestLabels}
                        onChange={(e) => updateOptions('suggestLabels', e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700">{t('common.suggestLabels')}</span>
                    </label>
                  </div>

                  {/* Watermark status — read-only, determined server-side */}
                  {watermark !== null && (
                    <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
                      watermark
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {watermark
                        ? t('common.freeTierWatermark')
                        : t('common.proTierNoWatermark')}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-slate-600 mb-1">{t('form.accessToken')}</label>
                    <input
                      type="password"
                      value={form.token}
                      onChange={(e) => updateField('token', e.target.value)}
                      placeholder={t('form.tokenPlaceholder')}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">{t('form.tokenHint')}</p>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={submit}
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition shadow-sm flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" strokeLinecap="round" />
                    </svg>
                    {t('common.loading')}
                  </>
                ) : (
                  <>{t('common.generate')} <span className="opacity-60 text-xs">(⌘+Enter)</span></>
                )}
              </button>
            </div>
          </section>

          {/* Right: Preview */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
              </div>
              <div className="text-xs text-slate-500 font-mono">{t('preview.title')}</div>
              {markdown && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-800 text-white rounded transition"
                  >
                    {t('common.copy')}
                  </button>
                  <button
                    onClick={downloadMd}
                    className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition"
                  >
                    {t('common.download')}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-6 max-h-[80vh]">
              {markdown ? (
                <article className="prose prose-sm max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {DOMPurify.sanitize(markdown)}
                  </Markdown>
                  {labels.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-slate-200">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">{t('preview.suggestedLabels')}</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {labels.map(label => (
                          <span
                            key={label}
                            className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
                    <path d="M9 12h6M9 16h6M9 8h6" strokeLinecap="round" />
                    <rect x="5" y="3" width="14" height="18" rx="2" />
                  </svg>
                  <p className="text-sm text-slate-500 font-medium">{t('preview.emptyState')}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('common.noDataStored')}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>{t('footer.copyright')}</p>
          <div className="flex items-center gap-4">
            <span>{t('footer.freeProInfo')}</span>
            <a href="#privacy" className="text-slate-500 hover:text-slate-700">{t('footer.privacy')}</a>
            <a href="#terms" className="text-slate-500 hover:text-slate-700">{t('footer.terms')}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

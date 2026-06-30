import translations from './zh-en.json'

export type Language = 'zh' | 'en'

export function getText(lang: Language, path: string, params?: Record<string, string | number>): string {
  const keys = path.split('.')
  let result: any = translations[lang] || translations.zh
  
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key]
    } else {
      return path
    }
  }
  
  let text = typeof result === 'string' ? result : path
  
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
    }
  }
  
  return text
}

export function getBrowserLanguage(): Language {
  if (typeof window === 'undefined') return 'zh'
  
  const browserLang = navigator.language || (navigator as any).userLanguage
  
  if (browserLang.startsWith('zh')) return 'zh'
  return 'en'
}
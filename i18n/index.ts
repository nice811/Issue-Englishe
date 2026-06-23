import translations from './zh-en.json'

export type Language = 'zh' | 'en'

export function getText(lang: Language, path: string): string {
  const keys = path.split('.')
  let result: any = translations[lang] || translations.zh
  
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key]
    } else {
      return path
    }
  }
  
  return typeof result === 'string' ? result : path
}

export function getBrowserLanguage(): Language {
  if (typeof window === 'undefined') return 'zh'
  
  const browserLang = navigator.language || (navigator as any).userLanguage
  
  if (browserLang.startsWith('zh')) return 'zh'
  return 'en'
}
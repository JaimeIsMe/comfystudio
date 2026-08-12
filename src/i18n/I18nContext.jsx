import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  normalizeLocale,
  resolveLanguage,
  translate,
} from './core'

const DEFAULT_LANGUAGES = [
  { code: 'en', name: 'English', file: 'lang_en.json', direction: 'ltr' },
  { code: 'ja', name: '日本語', file: 'lang_jp.json', direction: 'ltr' },
]

const I18nContext = createContext(null)

function getAssetUrl(filename) {
  const base = String(import.meta.env.BASE_URL || './')
  return `${base.endsWith('/') ? base : `${base}/`}lang/${filename}`
}

function getInitialLocale() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored) return normalizeLocale(stored)
  } catch (_) {
    // Storage can be unavailable in restricted browser contexts.
  }
  return normalizeLocale(typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANGUAGE)
}

async function fetchJson(filename) {
  const response = await fetch(getAssetUrl(filename))
  if (!response.ok) throw new Error(`Could not load language file: ${filename}`)
  return response.json()
}

export function I18nProvider({ children }) {
  const [languages, setLanguages] = useState(DEFAULT_LANGUAGES)
  const [language, setLanguageState] = useState(getInitialLocale)
  const [dictionaries, setDictionaries] = useState({})

  useEffect(() => {
    let cancelled = false
    fetchJson('languages.json')
      .then((manifest) => {
        if (cancelled || !Array.isArray(manifest?.languages) || manifest.languages.length === 0) return
        setLanguages(manifest.languages)
        setLanguageState((current) => resolveLanguage(current, manifest.languages))
      })
      .catch((error) => console.warn(error.message))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const selectedLanguage = resolveLanguage(language, languages)
    const englishFile = languages.find((item) => normalizeLocale(item.code) === DEFAULT_LANGUAGE)?.file || 'lang_en.json'
    const selectedFile = languages.find((item) => normalizeLocale(item.code) === selectedLanguage)?.file || englishFile

    Promise.all([
      dictionaries.en ? Promise.resolve(dictionaries.en) : fetchJson(englishFile),
      selectedLanguage === DEFAULT_LANGUAGE
        ? Promise.resolve(null)
        : (dictionaries[selectedLanguage] ? Promise.resolve(dictionaries[selectedLanguage]) : fetchJson(selectedFile)),
    ]).then(([english, selected]) => {
      if (cancelled) return
      setDictionaries((current) => ({
        ...current,
        en: english,
        ...(selected ? { [selectedLanguage]: selected } : {}),
      }))
    }).catch((error) => console.warn(error.message))

    return () => { cancelled = true }
  }, [language, languages])

  const setLanguage = useCallback((nextLanguage) => {
    const resolved = resolveLanguage(nextLanguage, languages)
    setLanguageState(resolved)
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, resolved)
    } catch (_) {
      // The in-memory choice still applies for this session.
    }
  }, [languages])

  const t = useCallback((key, variables, fallback) => (
    translate(dictionaries, language, key, variables, fallback)
  ), [dictionaries, language])

  useEffect(() => {
    const metadata = languages.find((item) => normalizeLocale(item.code) === language)
    document.documentElement.lang = language
    document.documentElement.dir = metadata?.direction === 'rtl' ? 'rtl' : 'ltr'
  }, [language, languages])

  const value = useMemo(() => ({ language, languages, setLanguage, t }), [language, languages, setLanguage, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}

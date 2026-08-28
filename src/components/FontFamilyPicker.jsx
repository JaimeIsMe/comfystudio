import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  getSystemFontCatalogSnapshot,
  loadSystemFontFamilies,
  mergeFontFamilies,
  resolveFontFamilySelection,
  subscribeSystemFontCatalog,
} from '../services/systemFonts'
import { useI18n } from '../i18n/I18nContext'
import { quoteCssFontFamily } from '../utils/fontFamily'

function useSystemFontCatalog() {
  const catalog = useSyncExternalStore(
    subscribeSystemFontCatalog,
    getSystemFontCatalogSnapshot,
    getSystemFontCatalogSnapshot
  )

  useEffect(() => {
    loadSystemFontFamilies()
  }, [])

  return catalog
}

export default function FontFamilyPicker({
  value,
  onChange,
  onCommit,
  className = '',
  disabled = false,
  ariaLabel,
}) {
  const { t } = useI18n()
  const catalog = useSystemFontCatalog()

  const fontFamilies = useMemo(
    () => mergeFontFamilies(catalog.families, value).sort((a, b) => (
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    )),
    [catalog.families, value]
  )
  const selectedFont = resolveFontFamilySelection(fontFamilies, value)

  return (
    <div className="min-w-0">
      <select
        value={selectedFont}
        onChange={(event) => {
          const nextValue = event.target.value
          if (nextValue === selectedFont) return
          if (typeof onCommit === 'function') onCommit(nextValue)
          else onChange?.(nextValue)
        }}
        disabled={disabled}
        aria-label={ariaLabel || t('fontPicker.ariaLabel')}
        className={className}
        style={{ fontFamily: quoteCssFontFamily(selectedFont) }}
      >
        {fontFamilies.map((font) => (
          <option
            key={font.toLocaleLowerCase()}
            value={font}
            style={{ fontFamily: quoteCssFontFamily(font) }}
          >
            {font}
          </option>
        ))}
      </select>

      {catalog.status === 'loading' && (
        <div className="mt-1 text-[9px] text-sf-text-muted" role="status">
          {t('fontPicker.loading')}
        </div>
      )}
      {catalog.status === 'error' && (
        <button
          type="button"
          onClick={() => loadSystemFontFamilies({ forceRefresh: true })}
          className="mt-1 text-left text-[9px] text-sf-text-muted hover:text-sf-accent"
          title={t('fontPicker.unavailableTitle')}
        >
          {t('fontPicker.retry')}
        </button>
      )}
    </div>
  )
}

import { Check, Contrast, Moon, Sun } from 'lucide-react'

import {
  APPEARANCE_PALETTES,
  type AppearancePalette,
  type AppearanceState,
  type ColorMode,
} from '../design/appearance'
import type { AppearanceMode } from '../../../shared/appearance'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

interface AppearanceSettingsProps {
  appearance: AppearanceState
  nativeStatus: string
  onChange: (appearance: AppearanceState) => void
  i18n?: I18nValue
}

const MATERIALS: readonly { value: AppearanceMode; label: MessageKey }[] = [
  { value: 'liquid', label: 'settings.appearance.material.liquid' },
  { value: 'mica', label: 'settings.appearance.material.mica' },
  { value: 'solid', label: 'settings.appearance.material.solid' },
]

const COLOR_CHOICES: readonly { value: ColorMode; label: MessageKey }[] = [
  { value: 'dark', label: 'settings.appearance.colorMode.dark' },
  { value: 'light', label: 'settings.appearance.colorMode.light' },
  { value: 'system', label: 'settings.appearance.colorMode.system' },
]

const PALETTE_LABELS: Record<AppearancePalette, MessageKey> = {
  polar: 'settings.appearance.palette.polar',
  verdigris: 'settings.appearance.palette.verdigris',
  amethyst: 'settings.appearance.palette.amethyst',
  cobalt: 'settings.appearance.palette.cobalt',
  garnet: 'settings.appearance.palette.garnet',
}

function AppearanceSettingsView({
  appearance,
  nativeStatus,
  onChange,
  i18n,
}: AppearanceSettingsProps & { i18n: I18nValue }) {
  const { t } = i18n
  const update = (patch: Partial<AppearanceState>): void => onChange({ ...appearance, ...patch })

  return (
    <section className="settings-section appearance-settings" aria-labelledby="appearance-heading">
      <header className="settings-header">
        <h2 id="appearance-heading">{t('settings.appearance.title')}</h2>
        <span className="native-material-status"><Contrast size={13} aria-hidden="true" />{nativeStatus}</span>
      </header>

      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.appearance.material')}</strong>
          <span>{t('settings.appearance.materialDescription')}</span>
        </div>
        <div className="segmented-control" role="radiogroup" aria-label={t('settings.appearance.material')}>
          {MATERIALS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={appearance.mode === choice.value}
              className={appearance.mode === choice.value ? 'is-selected' : undefined}
              onClick={() => update({ mode: choice.value })}
            >
              {t(choice.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.appearance.colorMode')}</strong>
          <span>{t('settings.appearance.colorModeDescription')}</span>
        </div>
        <div className="segmented-control icon-segments" role="radiogroup" aria-label={t('settings.appearance.colorMode')}>
          {COLOR_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={appearance.colorMode === choice.value}
              className={appearance.colorMode === choice.value ? 'is-selected' : undefined}
              onClick={() => update({ colorMode: choice.value })}
            >
              {choice.value === 'dark' ? <Moon size={14} /> : choice.value === 'light' ? <Sun size={14} /> : null}
              {t(choice.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row palette-setting">
        <div className="setting-label">
          <strong>{t('settings.appearance.palette')}</strong>
          <span>{t('settings.appearance.paletteDescription')}</span>
        </div>
        <div className="palette-swatches" role="radiogroup" aria-label={t('settings.appearance.palette')}>
          {APPEARANCE_PALETTES.map((palette) => (
            <button
              key={palette}
              type="button"
              role="radio"
              aria-label={t(PALETTE_LABELS[palette])}
              aria-checked={appearance.palette === palette}
              className="palette-option"
              data-swatch={palette}
              onClick={() => update({ palette })}
              title={t(PALETTE_LABELS[palette])}
            >
              <span className="swatch-color" />
              <span>{t(PALETTE_LABELS[palette])}</span>
              {appearance.palette === palette ? <Check size={13} /> : <span className="swatch-spacer" />}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <label className="setting-label" htmlFor="appearance-intensity">
          <strong>{t('settings.appearance.intensity')}</strong>
          <span>{Math.round(appearance.intensity * 100)}%</span>
        </label>
        <input
          id="appearance-intensity"
          aria-label={t('settings.appearance.intensity')}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={appearance.intensity}
          onChange={(event) => update({ intensity: Number(event.target.value) })}
        />
      </div>

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('settings.appearance.reduceMotion')}</strong>
          <span>{t('settings.appearance.reduceMotionDescription')}</span>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            aria-label={t('settings.appearance.reduceMotion')}
            checked={appearance.reduceMotion}
            onChange={(event) => update({ reduceMotion: event.target.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('settings.appearance.highContrast')}</strong>
          <span>{t('settings.appearance.highContrastDescription')}</span>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            aria-label={t('settings.appearance.highContrast')}
            checked={appearance.highContrast}
            onChange={(event) => update({ highContrast: event.target.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('settings.appearance.transparentDesktop')}</strong>
          <span>{t('settings.appearance.transparentDesktopDescription')}</span>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            aria-label={t('settings.appearance.transparentDesktop')}
            checked={appearance.transparentDesktop}
            onChange={(event) => update({ transparentDesktop: event.target.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </div>
    </section>
  )
}

function LocalizedAppearanceSettings(props: AppearanceSettingsProps) {
  return <AppearanceSettingsView {...props} i18n={useI18n()} />
}

export function AppearanceSettings(props: AppearanceSettingsProps) {
  return props.i18n
    ? <AppearanceSettingsView {...props} i18n={props.i18n} />
    : <LocalizedAppearanceSettings {...props} />
}

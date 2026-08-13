# Localizing Velorn

This guide explains how to add a new interface language and how to move remaining hard-coded UI text into Velorn's localization system.

English is the source and fallback language. A missing translation falls back to English, so a language can be developed incrementally without making the application unusable.

## Files involved

| File | Purpose |
| --- | --- |
| `public/lang/languages.json` | Languages shown in the Settings language selector |
| `public/lang/lang_en.json` | Canonical English dictionary and required key structure |
| `public/lang/lang_<code>.json` | One translated dictionary per language |
| `src/i18n/I18nContext.jsx` | Loads dictionaries, stores the selected language, and provides `t()` |
| `src/i18n/core.js` | Locale resolution, English fallback, nested-key lookup, and interpolation |
| `src/i18n/core.test.js` | Dictionary parity, placeholder, and protected-technical-value checks |
| `src/components/SettingsModal.jsx` | Language selector UI |

## Add a language

### 1. Choose a language code

Use a lowercase base language code such as `fr`, `de`, `es`, `ko`, or `ar`. The current resolver uses the base part of a browser locale, so `fr-FR` resolves to `fr` and `pt-BR` resolves to `pt`.

Regional variants that need separate dictionaries are not currently supported. Add resolver support and tests before registering variants such as separate `pt-BR` and `pt-PT` dictionaries.

### 2. Copy the English dictionary

Copy:

```text
public/lang/lang_en.json
```

to a new file, for example:

```text
public/lang/lang_fr.json
```

Translate JSON values only. Do not rename, remove, or reorganize keys.

Japanese uses `lang_jp.json` for compatibility with the original proposal, while its registered language code is the standard `ja`.

### 3. Register the language

Add an entry to `public/lang/languages.json`:

```json
{
  "code": "fr",
  "name": "Français",
  "file": "lang_fr.json",
  "direction": "ltr"
}
```

- Write `name` in the language itself so users can recognize it.
- Use `"direction": "ltr"` for left-to-right languages.
- Use `"direction": "rtl"` for right-to-left languages such as Arabic or Hebrew, and visually test all major workspaces because direction metadata alone cannot guarantee that every editor layout is RTL-ready.

No JavaScript import is required for a normal language addition. The runtime reads the manifest and fetches the selected JSON file.

### 4. Translate safely

Preserve named placeholders exactly:

```json
"greeting": "Hello, {{name}}"
```

The translated value must still contain `{{name}}`. Placeholder names are programmatic identifiers and must not be translated.

Keep valid JSON syntax:

- use double quotes;
- escape quotes inside strings;
- do not add comments;
- do not add trailing commas.

## Translation boundary

Translate the interface around the technology, not values that must match ComfyUI, command-line tools, project files, or external APIs.

Translate:

- navigation labels, buttons, menus, tabs, and tooltips;
- settings labels and descriptions;
- status messages, errors, warnings, confirmations, and empty states;
- help text and onboarding documentation;
- ordinary Velorn editing terms when the localized term is clear.

Keep unchanged:

- ComfyUI node, workflow, model, sampler, scheduler, and preset names;
- workflow categories or names that must match the upstream ComfyUI catalog;
- user-entered prompts and negative prompts;
- serialized values sent to ComfyUI or saved in a project;
- API fields, parameter keys, IDs, enum values, environment variables, and protocol names;
- command-line flags and examples such as `--listen`, `--port`, and `--disable-auto-launch`;
- file paths, URLs, extensions, endpoint paths, timecodes, keyboard bindings, and numeric input values;
- third-party product names and technical acronyms such as ComfyUI, LoRA, VAE, CLIP, ControlNet, CUDA, FFmpeg, NVENC, and API.

For example, translate **Choose a sampler**, but keep values such as `euler_ancestral` and `dpmpp_2m` unchanged. Translate a workflow description, but keep a workflow name such as `WAN 2.2 Image to Video` unchanged.

Localization must affect presentation only. Never use translated text as a command, workflow identifier, object key, saved enum, or value sent to ComfyUI.

## Move hard-coded UI text into the dictionaries

When localizing an untranslated React component:

### 1. Import the hook

For a component directly under `src/components`:

```jsx
import { useI18n } from '../i18n/I18nContext'
```

For a component one directory deeper, adjust the relative path:

```jsx
import { useI18n } from '../../i18n/I18nContext'
```

### 2. Call the hook in the component that renders the text

```jsx
function ExamplePanel() {
  const { t } = useI18n()
  // ...
}
```

Hooks must be called inside the correct React component. A production build may not detect a `t is not defined` error caused by placing the hook in a child component, so open the affected screen during manual verification.

### 3. Add the English key first

Add a stable, semantic key to `public/lang/lang_en.json`:

```json
{
  "example": {
    "save": "Save",
    "savedFor": "Saved for {{project}}"
  }
}
```

Prefer keys based on meaning and UI ownership, not the English sentence. For example, use `preview.emptyTitle`, not `preview.noPreviewSelectedText`.

### 4. Add the same key to every translation

Add the identical key structure and placeholders to each registered non-English dictionary:

```json
{
  "example": {
    "save": "Enregistrer",
    "savedFor": "Enregistré pour {{project}}"
  }
}
```

### 5. Replace only the displayed text

```jsx
<button>{t('example.save')}</button>
<p>{t('example.savedFor', { project: projectName })}</p>
```

Do not replace internal comparisons or values:

```jsx
// Correct: the value stays stable; only its label is translated.
<option value="local">{t('filters.local')}</option>

// Incorrect: translated values would change saved state and logic.
<option value={t('filters.local')}>{t('filters.local')}</option>
```

The translation lookup order is:

1. selected-language value;
2. English value;
3. explicit fallback passed to `t()`;
4. the key itself.

## Finding remaining hard-coded text

Useful searches include:

```sh
rg -n "title=\"|aria-label=\"|placeholder=\"" src/components
rg -n ">[A-Z][^<{]*<" src/components
```

Review every match rather than translating mechanically. Some literal strings are protected technical values, test fixtures, IDs, or data sent to ComfyUI.

Screenshots are useful for defining scope. Verify the visible label, its tooltip, disabled-state explanation, empty state, error state, and any collapsed or overflow menu that exposes the same action.

## Verification

Install dependencies if necessary, then run:

```sh
npm run test:i18n
npm run build
```

The i18n test checks every language registered in `languages.json` for:

- the same leaf keys as English;
- the same named placeholders as English;
- protected ComfyUI and technical values covered by regression tests.

Then test the packaged desktop application manually:

1. Select the new language in **Settings > Language**.
2. Restart Velorn and confirm the choice persists.
3. Open Welcome/Getting Started, Editor, Generate, Stock, ComfyUI, Export, and every Settings section.
4. Check tooltips, disabled controls, error states, dialogs, dropdowns, and narrow-window overflow menus.
5. Confirm ComfyUI workflows still queue correctly and prompts, node names, model names, CLI arguments, URLs, paths, and saved project data remain unchanged.
6. For RTL languages, inspect editor geometry, timelines, sliders, icons, and mixed RTL/technical text carefully.

`npm run build` validates compilation but does not prove that every screen renders. Always open the changed UI; React scope errors and layout overflow can appear only at runtime.

## Contribution checklist

- [ ] A new `public/lang/lang_<code>.json` file was added.
- [ ] `public/lang/languages.json` was updated.
- [ ] JSON keys match English exactly.
- [ ] Placeholder names match English exactly.
- [ ] Protected technical values remain unchanged.
- [ ] Only presentation text was localized.
- [ ] `npm run test:i18n` passes.
- [ ] `npm run build` passes.
- [ ] The packaged desktop UI was tested in the new language.
- [ ] The commit contains no generated builds, personal paths, credentials, logs, or test media.

If a translation is intentionally incomplete, leave the English key absent only while developing locally. Before contributing, copy the remaining English values into the new dictionary so key parity tests pass and future source-text changes remain reviewable.

# Localizing Velorn

Velorn loads interface translations from `public/lang` at runtime. English is
the fallback language, so an incomplete translation remains usable while it is
being developed.

## Add a language

1. Copy `public/lang/lang_en.json` to a new file such as
   `public/lang/lang_fr.json`.
2. Translate the values. Do not change the JSON keys or placeholders such as
   `{{name}}`.
3. Add the language to `public/lang/languages.json`:

   ```json
   { "code": "fr", "name": "Français", "file": "lang_fr.json", "direction": "ltr" }
   ```

Use a BCP 47 language code in `code`. Set `direction` to `rtl` for languages
such as Arabic or Hebrew. The language name should be written in that language
so users can recognize it in the selector.

Japanese uses the standard code `ja`, while its file is named `lang_jp.json`
for compatibility with the original localization proposal. Both `ja-JP` and
the informal `jp` alias resolve to Japanese.

## Translation boundary

Translate the interface around the technology, not the technical vocabulary
that must match ComfyUI or external documentation.

Translate:

- actions, buttons, settings, status messages, errors, and confirmations;
- navigation labels and ordinary Velorn editor features;
- help text and descriptions, while preserving protected technical terms
  inside the translated sentence.

Keep in English exactly as supplied by the integration:

- ComfyUI node, workflow, model, sampler, scheduler, and preset names;
- parameter keys, API fields, command-line flags, environment variables, file
  extensions, protocol names, and code identifiers;
- values that are serialized into a workflow or sent to ComfyUI;
- third-party product names and acronyms such as ComfyUI, LoRA, VAE, CLIP,
  ControlNet, CUDA, and API.

For example, translate `Choose a sampler`, but keep the selected values
`euler_ancestral` and `dpmpp_2m` unchanged. Translate a workflow description,
but keep its displayed workflow name `WAN 2.2 Image to Video` in English.

When a dictionary contains a protected name, copy the English value into every
language dictionary. Protected paths covered by automated tests must remain
byte-for-byte identical to the English dictionary.

## Use a translation in React

Call the translation hook inside a component:

```jsx
import { useI18n } from '../i18n/I18nContext'

const { t } = useI18n()
return <button>{t('common.save')}</button>
```

For a message with variables, use a named placeholder in every dictionary and
pass its value to `t`:

```json
{ "welcome": { "greeting": "Hello, {{name}}" } }
```

```jsx
t('welcome.greeting', { name: projectName })
```

If a key is not present in the selected language, Velorn uses the English
value. If it is also absent from English, the key itself is shown, making
missing entries visible during development.

## Verify

Run:

```sh
npm run test:i18n
npm run build
```

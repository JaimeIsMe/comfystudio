# Velorn v0.3.30

Velorn v0.3.30 adds an extensible interface-localization system and the first broad Japanese-language experience across the editor's most-used workflows.

## New

- **Initial Japanese interface.** Select `日本語` in `Settings > Language` to use Japanese across the project hub, editor shell, Timeline, Effects, Generate, Stock/Pexels, workflow setup, Settings, Export, and PNG image-sequence export.
- **Automatic locale detection and persistence.** Velorn recognizes supported system/browser locales on first use and remembers the creator's selected language across restarts.
- **Extensible language packs.** Interface languages now load from a small manifest and JSON dictionaries, making it possible to add more languages without adding a new JavaScript dependency or hard-wiring each language into the application.
- **Localization contributor guide.** The new `docs/LOCALIZATION.md` guide documents how to register a language, translate interface keys, preserve technical identifiers, and run the localization checks.

## Improved

- **Safe English fallback.** Missing translated strings fall back to English so language coverage can grow incrementally without exposing raw translation keys or making a workflow unusable.
- **Resilient dictionary loading.** Velorn waits for its English dictionary before rendering the application and provides a retry state if that required file cannot load.
- **Protected technical values.** Workflow names, model names, codecs, file paths, effect IDs, and keyboard bindings remain unchanged where translating them could break behavior or make troubleshooting harder.

## Notes

- This is the **initial** Japanese localization. Portions of major workflows, along with lower-traffic and highly technical surfaces, still appear in English and can be translated incrementally.
- Switching languages does not rewrite existing project files, media, workflow identifiers, or generated content.
- Thank you to [@ufotone](https://github.com/ufotone) for contributing the localization foundation and Japanese translation.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

# ASSETS_LICENSES.md

Every third-party or AI-generated asset gets one row: its origin and its licence (INSTRUCTIONS §7.2).
For AI image→3D tools, record the tool, the version and the licence terms that applied on the generation date.

| Asset path | Source / tool | Author | Licence | Date added | Notes |
|---|---|---|---|---|---|

## Audio

No third-party audio yet: every sound is synthesised in code (D-176). Recorded sounds dropped into `client/public/audio/` (listed in `manifest.json`) must be logged here with their source and licence (CC0 or royalty-free).

### Recorded drop-ins (when added)
- Sounds: `client/public/audio/<sound id>.ogg` (ids in `client/src/audio/sounds.ts`, e.g. `ui.click`, `fx.plant.herb`, `animal.bird`).
- Music: `client/public/audio/music.menu.ogg` (looped on the main menu) and `client/public/audio/music.game.ogg` (played now and then in a match).
- List each id in `client/public/audio/manifest.json` (a JSON array, e.g. `["music.menu"]`) and log the file here: title, author, source URL, licence.

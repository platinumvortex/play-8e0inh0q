# Third-party software

## EmulatorJS 4.2.3

- Project/source: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
- GPL-3.0: https://github.com/EmulatorJS/EmulatorJS/blob/v4.2.3/LICENSE
- Unmodified bundled frontend and extraction helpers from https://cdn.emulatorjs.org/stable/data/ (retrieved 2026-10-17).
- The frontend is instantiated and controlled by our separate app; no upstream source changes.

## MAME 2003 Plus / RetroArch web runtime

- Core version reported by runtime: `3a72dae`; stable build started 2025-06-14T19:09:40+00:00.
- MAME source: https://github.com/libretro/mame2003-plus-libretro/tree/3a72dae
- MAME license: https://github.com/libretro/mame2003-plus-libretro/blob/3a72dae/LICENSE.md
- Runtime source/build project: https://github.com/EmulatorJS/EmulatorJS
- Bundled `.data` archives contain their upstream build metadata and license.
- This legacy MAME core carries its upstream noncommercial license restrictions.

## PeerJS 1.5.5

- Source: https://github.com/peers/peerjs/tree/v1.5.5
- MIT license: https://github.com/peers/peerjs/blob/v1.5.5/LICENSE
- Bundle: https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js

## fflate 0.8.2

- Source: https://github.com/101arrowz/fflate/tree/v0.8.2
- MIT license: https://github.com/101arrowz/fflate/blob/v0.8.2/LICENSE
- Bundle: https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js

## ROM validation and key provenance

- Exact ROM driver: https://github.com/libretro/mame2003-plus-libretro/blob/3a72dae/src/drivers/cps2.c
- Published key words and watchdog: https://github.com/libretro/mame2010-libretro/blob/master/src/mame/machine/cps2crpt.c
- Key-file encoding: https://github.com/libretro/mame2003-plus-libretro/blob/3a72dae/src/machine/cps2crypt.c
- Super Street Fighter II Turbo and associated marks belong to Capcom. The game data was supplied by the user and bundled at their explicit request.

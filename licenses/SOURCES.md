# Third-party software

## EmulatorJS 4.2.3

- Project/source: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
- GPL-3.0: https://github.com/EmulatorJS/EmulatorJS/blob/v4.2.3/LICENSE
- Unmodified bundled frontend and extraction helpers from https://cdn.emulatorjs.org/stable/data/ (retrieved 2026-10-17).
- The frontend is instantiated and controlled by our separate app; no upstream source changes.

## FinalBurn Neo / RetroArch web runtime

- EmulatorJS stable core `fbneo-legacy-wasm.data`, build 2025-06-14T18:50:28+00:00 (core package 2.0.2).
- Chosen because its emulation is deterministic and its save states are complete, which online lockstep play requires (it is the core Fightcade uses for netplay). MAME 2003 Plus was tested first and drifted between two instances within seconds.
- Source: https://github.com/EmulatorJS/FBNeo (upstream https://github.com/finalburnneo/FBNeo)
- License: `licenses/FinalBurnNeo.txt` (verbatim from the bundled archive). FB Neo is non-commercial: it may not be sold or used for profit.
- Runtime source/build project: https://github.com/EmulatorJS/EmulatorJS

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

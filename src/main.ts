import Phaser from 'phaser';
import { sound } from './audio/sound';
import { pad } from './input/pad';
import { ControllerScene } from './render/ControllerScene';
import { awardFoul } from './sim/rules';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from './config';
import { DiagnosticsScene } from './render/DiagnosticsScene';
import { HowToPlayScene } from './render/HowToPlayScene';
import { HudScene } from './render/HudScene';
import { JoinScene } from './render/JoinScene';
import { LobbyScene } from './render/LobbyScene';
import { MatchScene } from './render/MatchScene';
import { MenuScene } from './render/MenuScene';
import { PauseScene } from './render/PauseScene';
import { ResultsScene } from './render/ResultsScene';
import { SettingsScene } from './render/SettingsScene';
import { TeamPickScene } from './render/TeamPickScene';

// Sound can only start after the first click or key press (browser autoplay rules).
sound.attachUnlock();
// T20: listens for a controller from the start, so the menus work with one too.
pad.start();

const game = new Phaser.Game({
  // The e2e build (T18) draws with the 2D canvas: the CI runner has no GPU, and Chromium's software WebGL there gives
  // a frame or two a second (two pages at once), against ~5x that with the canvas. Players get WebGL where available.
  type: import.meta.env.VITE_E2E ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: COLORS.background,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // DOM container: lets the menu use a real text input for room codes.
  dom: { createContainer: true },
  // The first scene starts automatically.
  // Order matters for drawing: later scenes are drawn on top (the pause menu and results go over the match and HUD).
  scene: [MenuScene, SettingsScene, ControllerScene, HowToPlayScene, JoinScene, TeamPickScene, LobbyScene, MatchScene, HudScene, PauseScene, ResultsScene, DiagnosticsScene],
});

// Dev only (and the e2e build, T18): lets the browser console and the Playwright tests inspect the running game, and
// (T19) give a foul on the host, to play a penalty online.
if (import.meta.env.DEV || import.meta.env.VITE_E2E) Object.assign(window, { __game: game, __sim: { awardFoul } });

import Phaser from 'phaser';
import { sound } from './audio/sound';
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

const game = new Phaser.Game({
  type: Phaser.AUTO,
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
  scene: [MenuScene, SettingsScene, HowToPlayScene, JoinScene, TeamPickScene, LobbyScene, MatchScene, HudScene, PauseScene, ResultsScene, DiagnosticsScene],
});

// Dev only: lets the browser console inspect the running game.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

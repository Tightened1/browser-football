import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from './config';
import { HudScene } from './render/HudScene';
import { MatchScene } from './render/MatchScene';

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
  scene: [MatchScene, HudScene],
});

// Dev only: lets the browser console inspect the running game.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

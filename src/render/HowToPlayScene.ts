import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { keysText, settings } from '../settings';
import { button, drawBackdrop, Focus, heading, label, UI_COLORS } from './ui';

const CX = GAME_WIDTH / 2;

/** The controls table (with whatever keys are currently bound) and a few lines on how a match works. */
export class HowToPlayScene extends Phaser.Scene {
  constructor() {
    super('HowToPlayScene');
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    heading(this, CX, 60, 'HOW TO PLAY');

    const b = settings.bindings;
    const move = (['up', 'down', 'left', 'right'] as const).map((a) => keysText(b, a)).join('   ');
    const rows: [string, string][] = [
      ['Move', `${move}`],
      ['Pass (tap) / Shoot (hold to charge, release)', `${keysText(b, 'pass')}   /   ${keysText(b, 'shoot')}`],
      ['Tackle / slide (when you have no ball)', keysText(b, 'tackle')],
      ['Switch player (when you have no ball)', keysText(b, 'switch')],
      ['AI debug overlay (roles, intents, team modes)', 'F2  /  `'],
      ['Network debug overlay (ping, snapshots, buffer, loss)', 'F3  /  N'],
      ['Pause menu / leave', 'Esc'],
    ];
    const top = 140;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(CX - 480, top - 22, 960, rows.length * 44 + 22, 12);
    rows.forEach(([action, keys], i) => {
      const y = top + 14 + i * 44;
      label(this, CX - 450, y, 21, UI_COLORS.text).setText(action).setOrigin(0, 0.5);
      label(this, CX + 450, y, 21, UI_COLORS.warn, true).setText(keys).setOrigin(1, 0.5);
    });

    const notes = [
      'You control one player of your 5-a-side team (the ringed one); the AI plays the rest.',
      'Press Switch to take over the teammate best placed to reach the ball. Control also moves to a player who receives your pass.',
      'Two halves, teams swap ends at half-time. Out-of-play restarts are quick: just play the ball when you are ready.',
      'Online: one player hosts and shares the room code or invite link; the other joins. You pick your own team and kit.',
      'Change any key under Settings. The pause menu does not stop an online match, since your friend is still playing.',
    ];
    notes.forEach((n, i) => label(this, CX, 515 + i * 34, 19, UI_COLORS.muted).setText(n).setWordWrapWidth(1000));

    const back = button(this, CX, 740, 'Back', () => this.scene.start('MenuScene'), { size: 22, width: 220 });
    new Focus(this, [{ button: back }]);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
  }
}

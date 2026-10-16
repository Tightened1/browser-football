import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RESTART_AUTO_DELAY_HUMAN } from '../config';
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
      ['Pass (tap) / Shoot (hold to charge, release), aimed with the move keys', `${keysText(b, 'pass')}   /   ${keysText(b, 'shoot')}`],
      ['Finesse shot (Arcade rules): hold shoot, tap pass -- curled and placed by a post', `${keysText(b, 'shoot')}  +  ${keysText(b, 'pass')}`],
      ['Tackle / slide (when you have no ball)', keysText(b, 'tackle')],
      ['Sprint (hold; uses stamina -- the bar under you; bigger touches with the ball)', keysText(b, 'sprint')],
      ['Shield the ball (hold, with the ball: slow, but hard to tackle from behind)', keysText(b, 'shield')],
      ['Feint / drag-back (with the ball): double-tap a move key, away from the defender', 'double-tap a move key'],
      ['Switch player (when you have no ball)', keysText(b, 'switch')],
      ['AI debug overlay (roles, intents, team modes, last touch)', 'F2  /  `'],
      ['Network debug overlay (ping, snapshots, buffer, loss)', 'F3  /  N'],
      ['Pause menu / leave', 'Esc'],
      ['Skip a goal replay (online: for both of you) or the full-time highlights', 'any other key'],
    ];
    const top = 120;
    const rowH = 30;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(CX - 500, top - 18, 1000, rows.length * rowH + 16, 12);
    rows.forEach(([action, keys], i) => {
      const y = top + 8 + i * rowH;
      label(this, CX - 470, y, 18, UI_COLORS.text).setText(action).setOrigin(0, 0.5);
      label(this, CX + 470, y, 18, UI_COLORS.warn, true).setText(keys).setOrigin(1, 0.5);
    });

    const notes = [
      'You control the ringed player; the AI plays the rest. Run into a loose ball to take it.',
      'The ball stays at your feet. A slide, a player in your way or a U-turn at full speed loses it.',
      'Kick just before the ball reaches you and it fires when it arrives (amber ring = waiting).',
      'An AI defender about to slide in crouches and flashes orange first: change direction (or feint) to beat it.',
      'Throw-ins and corners: aim with the move keys (yellow arrow), then pass = short throw / low cross, shoot = long / hard.',
      `A throw always goes into the pitch (wait ${RESTART_AUTO_DELAY_HUMAN} s: to a free teammate). You can't dribble over a line.`,
      'Match rules (Settings): Arcade = big goals, quick charge, aim line, aim assist, kinder keepers, relaxed AI tackling of humans.',
      "Classic = the original game. Online, the host's rules are used (shown in the lobby). Line up your shot: keys aim in 8 directions.",
      'Fouls: a slide into the player instead of the ball, or from behind, gives a free kick -- a penalty in the box. Strict referees show cards.',
      'Penalties: aim up / down (or neither, the middle), pass = placed, shoot = power. Facing one, dive with up / down + tackle.',
      "Online: one player hosts and shares the room code or invite link; the other joins. You pick your own club and kit; if they clash, the host's kit stays and the guest's changes.",
      'Clubs: any Premier League club, with its real players and numbers (cosmetic: all clubs play the same). Unofficial fan game, not affiliated with the Premier League or any club.',
      'Change any key under Settings. The pause menu does not stop an online match, since your friend is still playing.',
    ];
    notes.forEach((n, i) => label(this, CX, 490 + i * 23, 15, UI_COLORS.muted).setText(n).setWordWrapWidth(1120));

    const back = button(this, CX, 765, 'Back', () => this.scene.start('MenuScene'), { size: 22, width: 220 });

    new Focus(this, [{ button: back }]);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
  }
}

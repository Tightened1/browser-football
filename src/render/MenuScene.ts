import Phaser from 'phaser';
import { AI_VS_AI, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { normalizeRoomCode } from '../net/roomCode';
import { GAME_VERSION } from '../net/protocol';
import { button, drawBackdrop, Focus, label, UI_COLORS } from './ui';
import type { TeamPickData } from './TeamPickScene';

const CX = GAME_WIDTH / 2;

/** URL options are acted on once per page load, so "back to menu" doesn't re-trigger them. */
let urlHandled = false;

/** Title screen: play offline vs the AI, host or join an online game, settings, how to play. Keyboard or mouse. */
export class MenuScene extends Phaser.Scene {
  private message!: Phaser.GameObjects.Text;

  constructor() {
    super('MenuScene');
  }

  create(data: { message?: string } = {}): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);

    label(this, CX, 130, 76, UI_COLORS.text, true).setText('BROWSER FOOTBALL').setStroke('#000000', 8);
    label(this, CX, 195, 24, UI_COLORS.muted).setText('5-a-side arcade football · play the AI or a friend online');

    const wide = { width: 380 };
    const play = button(this, CX, 290, 'Play vs AI', () => this.pickTeam({ mode: 'offline' }), wide);
    const host = button(this, CX, 365, 'Host online', () => this.pickTeam({ mode: 'host' }), wide);
    const join = button(this, CX, 440, 'Join online', () => this.scene.start('JoinScene'), wide);
    const settings = button(this, CX - 100, 525, 'Settings', () => this.scene.start('SettingsScene'), { width: 190, secondary: true });
    const how = button(this, CX + 100, 525, 'How to play', () => this.scene.start('HowToPlayScene'), { width: 190, secondary: true });
    const test = button(this, CX, 600, 'Test my connection', () => this.scene.start('DiagnosticsScene'), { size: 20, width: 260, secondary: true });
    new Focus(this, [{ button: play }, { button: host }, { button: join }, { button: settings }, { button: how }, { button: test }]);

    this.message = label(this, CX, 665, 22, UI_COLORS.warn).setWordWrapWidth(900);
    if (data.message) this.message.setText(data.message);

    label(this, CX, GAME_HEIGHT - 70, 18, UI_COLORS.muted).setText('↑ ↓ ← → to move · Enter to choose · or just click');
    label(this, CX, GAME_HEIGHT - 40, 15, '#7f9488').setText(`v${GAME_VERSION}`);

    this.handleUrlOnce();
  }

  /** ?room=CODE (an invite link) goes to the team picker and then joins that room; ?aivsai goes straight into a match. */
  private handleUrlOnce(): void {
    if (urlHandled) return;
    urlHandled = true;
    const q = new URLSearchParams(window.location.search);
    const room = q.get('room');
    if (room !== null) {
      const code = normalizeRoomCode(room);
      if (code) this.pickTeam({ mode: 'join', code });
      else this.message.setText(`The invite link's room code "${room}" doesn't look right. Check it and try again.`);
      return;
    }
    if (AI_VS_AI || q.has('aivsai')) this.scene.start('MatchScene', {});
  }

  private pickTeam(data: TeamPickData): void {
    this.scene.start('TeamPickScene', data);
  }
}

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, AI_VS_AI } from '../config';
import { normalizeRoomCode } from '../net/roomCode';
import { GAME_VERSION } from '../net/protocol';
import { button, label, UI_COLORS, UI_FONT } from './ui';
import type { LobbySceneData } from './LobbyScene';

const CX = GAME_WIDTH / 2;

/** URL options are acted on once per page load, so "back to menu" doesn't re-trigger them. */
let urlHandled = false;

/** Title menu: play offline vs the AI, host an online game, or join one by room code. */
export class MenuScene extends Phaser.Scene {
  private codeInput!: HTMLInputElement;
  private message!: Phaser.GameObjects.Text;

  constructor() {
    super('MenuScene');
  }

  create(data: { message?: string } = {}): void {
    this.cameras.main.setBackgroundColor('#14361c');
    this.drawBackdrop();

    label(this, CX, 130, 76, UI_COLORS.text, true).setText('BROWSER FOOTBALL').setStroke('#000000', 8);
    label(this, CX, 195, 24, UI_COLORS.muted).setText('5-a-side arcade football · play the AI or a friend online');

    button(this, CX, 290, 'Play vs AI', () => this.scene.start('MatchScene', {}), { width: 380 });
    button(this, CX, 375, 'Host online game', () => this.openLobby({ mode: 'host' }), { width: 380 });

    label(this, CX, 460, 22, UI_COLORS.muted).setText("Join a friend's game — enter their room code:");
    const dom = this.add.dom(CX - 95, 515).createFromHTML(
      `<input type="text" maxlength="60" placeholder="PASS-4827" autocomplete="off" spellcheck="false" aria-label="Room code"
        style="width:260px;padding:10px 14px;font:bold 26px ${UI_FONT};text-transform:uppercase;letter-spacing:2px;
        border:3px solid #ffffff;border-radius:6px;background:#0d2412;color:#ffffff;outline:none;text-align:center">`,
    );
    this.codeInput = (dom.node as HTMLElement).querySelector('input')!;
    this.codeInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.join();
    });
    button(this, CX + 135, 515, 'Join', () => this.join(), { width: 100 });

    this.message = label(this, CX, 585, 22, UI_COLORS.warn).setWordWrapWidth(900);
    if (data.message) this.message.setText(data.message);

    label(this, CX, GAME_HEIGHT - 95, 18, UI_COLORS.muted).setText(
      'Move: arrows / WASD    Pass: X    Shoot: Space (hold to charge)    Tackle: C    Switch: Z / Shift    Menu: Esc',
    );
    label(this, CX, GAME_HEIGHT - 50, 15, '#7f9488').setText(`v${GAME_VERSION}`);

    this.handleUrlOnce();
  }

  /** ?room=CODE (an invite link) fills in the code and joins straight away; ?aivsai goes straight into a match. */
  private handleUrlOnce(): void {
    if (urlHandled) return;
    urlHandled = true;
    const q = new URLSearchParams(window.location.search);
    const room = q.get('room');
    if (room !== null) {
      this.codeInput.value = room.toUpperCase();
      const code = normalizeRoomCode(room);
      if (code) this.openLobby({ mode: 'join', code });
      else this.message.setText(`The invite link's room code "${room}" doesn't look right. Check it and try again.`);
      return;
    }
    if (AI_VS_AI || q.has('aivsai')) this.scene.start('MatchScene', {});
  }

  private join(): void {
    const code = normalizeRoomCode(this.codeInput.value);
    if (!code) {
      this.message.setText('Room codes look like PASS-4827: a 4-letter word and 4 digits.');
      this.codeInput.focus();
      return;
    }
    this.openLobby({ mode: 'join', code });
  }

  private openLobby(data: LobbySceneData): void {
    this.scene.start('LobbyScene', data);
  }

  private drawBackdrop(): void {
    const g = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      g.fillStyle(i % 2 ? 0x173d20 : 0x14361c, 1);
      g.fillRect((GAME_WIDTH / 12) * i, 0, GAME_WIDTH / 12 + 1, GAME_HEIGHT);
    }
    g.lineStyle(4, 0xffffff, 0.08);
    g.strokeCircle(CX, GAME_HEIGHT / 2, 220);
    g.lineBetween(CX, 0, CX, GAME_HEIGHT);
  }
}

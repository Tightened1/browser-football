import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { normalizeRoomCode } from '../net/roomCode';
import { button, drawBackdrop, Focus, heading, label, UI_COLORS, UI_FONT } from './ui';

const CX = GAME_WIDTH / 2;

/** "Join online": type the room code (or open an invite link instead), then pick a team. */
export class JoinScene extends Phaser.Scene {
  private codeInput!: HTMLInputElement;
  private message!: Phaser.GameObjects.Text;
  private focus!: Focus;

  constructor() {
    super('JoinScene');
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    heading(this, CX, 120, 'JOIN AN ONLINE GAME', "Ask your friend for the room code they see after pressing 'Host online'");

    label(this, CX, 270, 24, UI_COLORS.muted).setText('Room code');
    const dom = this.add.dom(CX, 335).createFromHTML(
      `<input type="text" maxlength="60" placeholder="PASS-4827" autocomplete="off" spellcheck="false" aria-label="Room code"
        style="width:340px;padding:12px 14px;font:bold 32px ${UI_FONT};text-transform:uppercase;letter-spacing:3px;
        border:3px solid #ffffff;border-radius:6px;background:#0d2412;color:#ffffff;outline:none;text-align:center">`,
    );
    this.codeInput = (dom.node as HTMLElement).querySelector('input')!;

    const join = button(this, CX, 440, 'Join', () => this.join(), { width: 240 });
    const back = button(this, CX, 520, 'Back', () => this.scene.start('MenuScene'), { width: 240, secondary: true });
    // Registered before Focus, so it sees ↑ while the join button still has focus.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' && this.focus.current?.button === join) {
        this.focus.suspend(true);
        this.codeInput.focus();
      }
    });
    this.focus = new Focus(this, [{ button: join }, { button: back }]);
    this.message = label(this, CX, 600, 22, UI_COLORS.warn).setWordWrapWidth(900);
    label(this, CX, GAME_HEIGHT - 60, 18, UI_COLORS.muted).setText('Enter: join · ↓: buttons · Esc: back');

    // The text box has the keyboard; ↓ hands it to the buttons (and ↑ on the top button hands it back).
    this.focus.suspend(true);
    this.codeInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the game's own keyboard handling must not see what is typed here
      if (e.key === 'Enter') this.join();
      else if (e.key === 'Escape') this.scene.start('MenuScene');
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.codeInput.blur();
        this.focus.suspend(false);
      }
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
    this.codeInput.focus();
  }

  private join(): void {
    const code = normalizeRoomCode(this.codeInput.value);
    if (!code) {
      this.message.setText('Room codes look like PASS-4827: a 4-letter word and 4 digits.');
      this.codeInput.focus();
      return;
    }
    this.scene.start('TeamPickScene', { mode: 'join', code });
  }
}

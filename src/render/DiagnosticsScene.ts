import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { DiagnosticsRun } from '../net/diagnostics';
import { diagnosticsReportText, summarizeDiagnostics, type CheckLevel, type CheckRow } from '../net/ice';
import { GAME_VERSION } from '../net/protocol';
import { button, copyText, label, UI_COLORS, UI_FONT, type Button } from './ui';

const CX = GAME_WIDTH / 2;
const LEFT = 90;
const DETAIL_X = 400;
const ROWS_TOP = 222;

const ICON: Record<CheckLevel, string> = { ok: '✔', warn: '!', bad: '✖', pending: '…', info: 'i' };
const COLOR: Record<CheckLevel, string> = { ok: UI_COLORS.good, warn: UI_COLORS.warn, bad: UI_COLORS.bad, pending: UI_COLORS.muted, info: UI_COLORS.muted };

/** "Test my connection": runs the network checks and shows each result in plain English. Reads a DiagnosticsRun. */
export class DiagnosticsScene extends Phaser.Scene {
  private run!: DiagnosticsRun;
  private verdict!: Phaser.GameObjects.Text;
  private rows!: Phaser.GameObjects.Container;
  private shown = '';
  private copy!: Button;
  private again!: Button;
  private copiedTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('DiagnosticsScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#14361c');
    this.shown = '';
    label(this, CX, 50, 40, UI_COLORS.text, true).setText('CONNECTION TEST');
    label(this, CX, 96, 19, UI_COLORS.muted)
      .setText('Checks what this network allows for online play. Both players should run it — a game needs both ends to work.')
      .setWordWrapWidth(1050);
    this.verdict = label(this, CX, 160, 23, UI_COLORS.text, true).setWordWrapWidth(1000);
    this.rows = this.add.container(0, 0);

    const y = GAME_HEIGHT - 55;
    this.again = button(this, CX - 250, y, 'Run again', () => this.scene.restart(), { size: 22, width: 200 });
    this.copy = button(this, CX, y, 'Copy report', () => void this.copyReport(), { size: 22, width: 200, secondary: true });
    button(this, CX + 250, y, 'Back', () => this.scene.start('MenuScene'), { size: 22, width: 200, secondary: true });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));

    this.run = new DiagnosticsRun();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.run.cancel());
  }

  update(): void {
    const summary = summarizeDiagnostics(this.run.results);
    this.again.setEnabled(this.run.done);
    this.copy.setEnabled(this.run.done);
    const key = JSON.stringify(summary);
    if (key === this.shown) return;
    this.shown = key;
    this.verdict.setText(summary.verdict.detail).setColor(COLOR[summary.verdict.level]);
    this.drawRows(summary.rows);
  }

  private drawRows(rows: CheckRow[]): void {
    this.rows.removeAll(true);
    let y = ROWS_TOP;
    for (const row of rows) {
      const style = { fontFamily: UI_FONT, color: COLOR[row.level] };
      const icon = this.add.text(LEFT, y, ICON[row.level], { ...style, fontSize: '22px', fontStyle: 'bold' });
      const title = this.add.text(LEFT + 36, y + 2, row.title, { ...style, fontSize: '19px', fontStyle: 'bold', wordWrap: { width: DETAIL_X - LEFT - 46 } });
      const detail = this.add.text(DETAIL_X, y + 3, row.detail, { fontFamily: UI_FONT, fontSize: '17px', color: UI_COLORS.text, wordWrap: { width: GAME_WIDTH - DETAIL_X - 70 } });
      this.rows.add([icon, title, detail]);
      y += Math.max(title.height, detail.height) + 16;
    }
  }

  private async copyReport(): Promise<void> {
    const r = this.run.results;
    const ok = await copyText(diagnosticsReportText(summarizeDiagnostics(r), r, GAME_VERSION));
    this.copy.setLabel(ok ? 'Copied!' : 'Copy failed');
    this.copiedTimer?.remove();
    this.copiedTimer = this.time.delayedCall(1500, () => this.copy.setLabel('Copy report'));
  }
}

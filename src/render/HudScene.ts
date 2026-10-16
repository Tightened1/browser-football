import Phaser from 'phaser';
import { GAME_HEIGHT, GOAL_PAUSE, GAME_WIDTH, HALVES, SHOOTOUT_KICKS, SIM_HZ } from '../config';
import { keyLabel, settings, type ActionId } from '../settings';
import { readableColor, teamStyle } from './teamStyle';
import { matchClock, periodLength } from '../sim/rules';
import { shootoutTally } from '../sim/fouls';
import type { GameState, MatchEvent, RestartType, ShootoutRecord, TeamId } from '../sim/types';
import type { MatchScene } from './MatchScene';

const FONT = 'sans-serif';
const BAR_W = 560;
const BAR_H = 50;
const BAR_Y = 10;
const CX = GAME_WIDTH / 2;

const RESTART_LABEL: Record<Exclude<RestartType, 'kickoff'>, string> = {
  'throw-in': 'THROW-IN',
  'goal-kick': 'GOAL KICK',
  corner: 'CORNER',
  'free-kick': 'FREE KICK',
  penalty: 'PENALTY',
};
/** How long the foul / card and penalty-result banners stay up (s). */
const BANNER_SECONDS = 1.6;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function halfLabel(half: number): string {
  return half === 1 ? '1ST HALF' : half === 2 ? '2ND HALF' : half > HALVES ? 'EXTRA TIME' : `HALF ${half}`;
}

/** The newest event of one of `types` from the last `seconds` of the drawn match, if any. */
function recentEvent(s: GameState, types: readonly MatchEvent['type'][], seconds: number): MatchEvent | undefined {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (s.tick - e.tick > seconds * SIM_HZ) return undefined;
    if (types.includes(e.type)) return e;
  }
  return undefined;
}

/** "3 – 2" in the shoot-out. */
export function shootoutScoreText(so: Pick<ShootoutRecord, 'first' | 'kicks'>): string {
  const { goals } = shootoutTally(so);
  return `${goals[0]} – ${goals[1]}`;
}

/** Score, team names and colours, clock, half, "GOAL!" banner and the half-time / full-time overlays. Reads the match state only. */
export class HudScene extends Phaser.Scene {
  private score!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private names!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private clock!: Phaser.GameObjects.Text;
  private half!: Phaser.GameObjects.Text;
  private restartLabel!: Phaser.GameObjects.Text;
  private goalBanner!: Phaser.GameObjects.Container;
  private goalTeam!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Container;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayScore!: Phaser.GameObjects.Text;
  private overlayInfo!: Phaser.GameObjects.Text;
  private netPanel!: Phaser.GameObjects.Container;
  private netTitle!: Phaser.GameObjects.Text;
  private netBody!: Phaser.GameObjects.Text;
  private netHint!: Phaser.GameObjects.Text;
  /** T19: cards by the team names, the foul / card banner, the penalty hint and result, the shoot-out scoreboard. */
  private cardGfx!: Phaser.GameObjects.Graphics;
  private foulBanner!: Phaser.GameObjects.Text;
  private cardBanner!: Phaser.GameObjects.Text;
  private penaltyHint!: Phaser.GameObjects.Text;
  private penaltyBanner!: Phaser.GameObjects.Text;
  private shootoutGfx!: Phaser.GameObjects.Graphics;
  private shootoutTitle!: Phaser.GameObjects.Text;
  private shootoutNames!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];

  constructor() {
    super('HudScene');
  }

  private text(x: number, y: number, size: number, color = '#ffffff', bold = true): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, stroke: '#000000', strokeThickness: Math.max(2, size / 8) })
      .setOrigin(0.5);
  }

  create(): void {
    // Top bar: [swatch name score] clock [score name swatch].
    const bar = this.add.graphics();
    bar.fillStyle(0x000000, 0.65);
    bar.fillRoundedRect(CX - BAR_W / 2, BAR_Y, BAR_W, BAR_H, 10);
    for (const team of [0, 1] as const) {
      bar.fillStyle(teamStyle(team).kit, 1);
      bar.fillRoundedRect(team === 0 ? CX - BAR_W / 2 + 8 : CX + BAR_W / 2 - 20, BAR_Y + 8, 12, BAR_H - 16, 3);
      bar.lineStyle(2, teamStyle(team).outline, 1);
      bar.strokeRoundedRect(team === 0 ? CX - BAR_W / 2 + 8 : CX + BAR_W / 2 - 20, BAR_Y + 8, 12, BAR_H - 16, 3);
    }
    this.names = [this.text(CX - 190, BAR_Y + BAR_H / 2, 20), this.text(CX + 190, BAR_Y + BAR_H / 2, 20)];
    this.score = [this.text(CX - 82, BAR_Y + BAR_H / 2, 32), this.text(CX + 82, BAR_Y + BAR_H / 2, 32)];
    this.clock = this.text(CX, BAR_Y + 18, 22);
    this.half = this.text(CX, BAR_Y + 39, 11, '#cccccc');
    this.restartLabel = this.text(CX, BAR_Y + BAR_H + 18, 18, '#ffe27a').setVisible(false);
    this.cardGfx = this.add.graphics();
    this.penaltyHint = this.text(CX, GAME_HEIGHT - 44, 17, '#ffffff', false).setVisible(false);
    this.foulBanner = this.text(CX, GAME_HEIGHT / 2 - 150, 54, '#ffffff').setStroke('#000000', 8).setText('FOUL!').setVisible(false);
    this.cardBanner = this.text(CX, GAME_HEIGHT / 2 - 98, 26).setVisible(false);
    this.penaltyBanner = this.text(CX, GAME_HEIGHT / 2 - 120, 64, '#ffd23f').setStroke('#000000', 9).setVisible(false);
    // Shoot-out scoreboard, under the score bar.
    this.shootoutGfx = this.add.graphics();
    this.shootoutTitle = this.text(CX, BAR_Y + BAR_H + 22, 18, '#ffd23f').setVisible(false);
    this.shootoutNames = [this.text(CX - 150, BAR_Y + BAR_H + 50, 16), this.text(CX - 150, BAR_Y + BAR_H + 76, 16)];
    for (const t of this.shootoutNames) t.setOrigin(1, 0.5).setVisible(false);

    // GOAL! banner.
    const goalText = this.text(0, 0, 110, '#ffd23f');
    goalText.setText('GOAL!').setStroke('#000000', 12);
    this.goalTeam = this.text(0, 78, 30);
    this.goalBanner = this.add.container(CX, GAME_HEIGHT / 2 - 40, [goalText, this.goalTeam]).setVisible(false);

    // Half-time / full-time overlay.
    const shade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65);
    this.overlayTitle = this.text(0, -120, 72);
    this.overlayScore = this.text(0, -20, 64);
    this.overlayInfo = this.text(0, 50, 26, '#dddddd');
    this.overlay = this.add
      .container(0, 0, [shade, this.add.container(CX, GAME_HEIGHT / 2, [this.overlayTitle, this.overlayScore, this.overlayInfo])])
      .setVisible(false);

    // Online: connection trouble / match ended (drawn above everything else).
    const netShade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55);
    const netBox = this.add.rectangle(CX, GAME_HEIGHT / 2, 760, 260, 0x22303a, 0.95).setStrokeStyle(3, 0xffd23f);
    this.netTitle = this.text(0, -70, 44, '#ffd23f');
    this.netBody = this.text(0, 5, 22, '#ffffff', false).setWordWrapWidth(680).setAlign('center');
    this.netHint = this.text(0, 85, 18, '#cccccc', false);
    this.netPanel = this.add
      .container(0, 0, [netShade, netBox, this.add.container(CX, GAME_HEIGHT / 2, [this.netTitle, this.netBody, this.netHint])])
      .setDepth(100)
      .setVisible(false);

    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.match()?.netOverlay()?.ended) this.match()?.quit();
    });
  }

  private match(): MatchScene | undefined {
    return this.scene.get('MatchScene') as MatchScene | undefined;
  }

  private matchState(): GameState | undefined {
    return this.match()?.getState();
  }

  update(): void {
    const s = this.matchState();
    if (!s) return;
    for (const team of [0, 1] as const) {
      this.names[team].setText(teamStyle(team).name);
      this.score[team].setText(String(s.score[team]));
    }
    this.clock.setText(formatClock(matchClock(s)));
    const shootout = s.phase === 'shootout' || (s.phase === 'full-time' && !!s.shootout);
    this.half.setText(shootout ? 'PENALTIES' : `${halfLabel(s.half)}  ·  ${formatClock(s.clock)}/${formatClock(periodLength(s))}`);

    // Set-piece label (not in a shoot-out: its scoreboard says it all).
    const r = s.restart;
    const label = s.phase === 'playing' && r && r.type !== 'kickoff' ? `${RESTART_LABEL[r.type]} — ${teamStyle(r.team).name}` : '';
    this.restartLabel.setText(label).setVisible(label !== '');
    this.drawCards(s);
    this.drawFoul(s);
    this.drawPenalty(s);
    this.drawShootout(s, shootout);

    // GOAL! banner.
    const goal = s.phase === 'goal-scored' ? [...s.events].reverse().find((e) => e.type === 'goal') : undefined;
    this.goalBanner.setVisible(!!goal);
    if (goal && goal.team !== undefined) {
      this.goalTeam.setText(`${teamStyle(goal.team).name}${goal.ownGoal ? ' (own goal)' : ''}`).setColor(hex(teamStyle(goal.team).kit)).setStroke('#ffffff', 5);
      // Pops in big and settles, then keeps a gentle pulse.
      const since = Math.max(0, GOAL_PAUSE - s.phaseTimer);
      const pop = Math.max(0, 1 - since / 0.3) ** 2;
      const pulse = 1 + 0.06 * Math.sin(this.time.now / 90);
      this.goalBanner.setScale(pulse * (1 + 0.9 * pop)).setAngle(-4 * pop);
    }

    // Half-time overlay (full time has its own results screen); before golden-goal extra time it says so.
    const halfTime = s.phase === 'half-time';
    this.overlay.setVisible(halfTime);
    if (halfTime) {
      const extra = s.half >= HALVES;
      this.overlayTitle.setText(extra ? 'EXTRA TIME' : 'HALF TIME');
      this.overlayScore.setText(`${teamStyle(0).name} ${s.score[0]} – ${s.score[1]} ${teamStyle(1).name}`);
      const left = Math.max(0, Math.ceil(s.phaseTimer));
      this.overlayInfo.setText(extra ? `Golden goal: the first goal wins (then penalties) — ${left}` : `Teams swap ends — ${left}`);
    }

    const net = this.match()?.netOverlay() ?? null;
    this.netPanel.setVisible(!!net);
    if (net) {
      this.netTitle.setText(net.title);
      this.netBody.setText(net.body);
      this.netHint.setText(net.ended ? 'Press Enter or Esc to return to the menu' : 'Esc: menu');
    }
  }

  /** Cards by each team's name: a yellow for each booked player, a red for each one sent off. */
  private drawCards(s: GameState): void {
    const g = this.cardGfx;
    g.clear();
    for (const team of [0, 1] as const) {
      const cards = s.players.filter((p) => p.team === team && (p.yellow > 0 || p.sentOff)).map((p) => (p.sentOff ? 0xe8322b : 0xf5d90a));
      cards.forEach((color, i) => {
        const x = team === 0 ? CX - BAR_W / 2 + 30 + i * 12 : CX + BAR_W / 2 - 38 - i * 12;
        g.fillStyle(color, 1);
        g.fillRect(x, BAR_Y + BAR_H + 4, 8, 12);
        g.lineStyle(1, 0x000000, 0.8);
        g.strokeRect(x, BAR_Y + BAR_H + 4, 8, 12);
      });
    }
  }

  /** "FOUL!", and the card shown for it. */
  private drawFoul(s: GameState): void {
    const foul = recentEvent(s, ['foul'], BANNER_SECONDS);
    this.foulBanner.setVisible(!!foul);
    const card = foul ? s.events.find((e) => e.tick === foul.tick && (e.type === 'yellow-card' || e.type === 'red-card')) : undefined;
    this.cardBanner.setVisible(!!card);
    if (card && card.team !== undefined && card.player !== undefined) {
      const p = s.players[card.player];
      const red = card.type === 'red-card';
      this.cardBanner
        .setText(`${red ? 'RED CARD' : 'YELLOW CARD'} — #${p?.number ?? '?'} ${teamStyle(card.team).name}${red ? ' (second yellow: sent off)' : ''}`)
        .setColor(red ? '#ff5a4f' : '#f5d90a');
    }
  }

  /** At a penalty: how to take it, or how to save it, for whichever of them is yours; then SCORED / SAVED / MISSED. */
  private drawPenalty(s: GameState): void {
    const r = s.restart;
    const me = this.match()?.localTeam() ?? null;
    let hint = '';
    if (r?.type === 'penalty' && me !== null) {
      const key = (a: ActionId): string => keyLabel(settings.bindings[a][0] || settings.bindings[a][1]);
      const across = `${key('up')} / ${key('down')}`;
      if (r.team === me) hint = `Penalty: aim ${across} (neither: the middle)  ·  ${key('pass')} placed  ·  hold ${key('shoot')} for power`;
      else if (s.controlled[me] >= 0 && s.players[s.controlled[me]]?.role === 'keeper') hint = `You're in goal: dive ${across} + ${key('tackle')} (or stand still for the middle)`;
    }
    this.penaltyHint.setText(hint).setVisible(hint !== '');
    const res = recentEvent(s, ['penalty-result'], BANNER_SECONDS);
    this.penaltyBanner.setVisible(!!res && s.phase !== 'goal-scored');
    if (res) this.penaltyBanner.setText(res.scored ? 'SCORED!' : res.saved ? 'SAVED!' : 'MISSED!').setColor(res.scored ? '#7ee081' : '#ffd23f');
  }

  /** The shoot-out scoreboard: a row of kicks per team (scored, missed, still to come) and the score. */
  private drawShootout(s: GameState, on: boolean): void {
    const g = this.shootoutGfx;
    g.clear();
    const so = s.shootout;
    this.shootoutTitle.setVisible(on && !!so);
    for (const t of this.shootoutNames) t.setVisible(on && !!so);
    if (!on || !so) return;
    const { taken } = shootoutTally(so);
    const done = so.winner >= 0;
    this.shootoutTitle.setText(`PENALTIES  ${shootoutScoreText(so)}${done ? `  —  ${teamStyle(so.winner as TeamId).name} win` : ''}`);
    const slots = Math.max(SHOOTOUT_KICKS, taken[0], taken[1]);
    const w = Math.max(320, 190 + slots * 26);
    g.fillStyle(0x000000, 0.65);
    g.fillRoundedRect(CX - w / 2, BAR_Y + BAR_H + 6, w, 84, 8);
    for (const team of [0, 1] as const) {
      const y = BAR_Y + BAR_H + 50 + team * 26;
      const name = this.shootoutNames[team];
      name.setText(teamStyle(team).name).setColor(hex(readableColor(team))).setPosition(CX - w / 2 + 120, y);
      const kicks = so.kicks.filter((_, i) => (so.first + i) % 2 === team);
      for (let k = 0; k < slots; k++) {
        const x = CX - w / 2 + 140 + k * 26;
        if (k >= kicks.length) {
          g.lineStyle(2, 0xffffff, 0.6);
          g.strokeCircle(x, y, 8);
        } else if (kicks[k]) {
          g.fillStyle(0x4cd964, 1);
          g.fillCircle(x, y, 9);
        } else {
          g.lineStyle(3, 0xff4040, 1);
          g.lineBetween(x - 7, y - 7, x + 7, y + 7);
          g.lineBetween(x - 7, y + 7, x + 7, y - 7);
        }
      }
    }
  }
}

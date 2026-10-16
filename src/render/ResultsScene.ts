import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { manOfTheMatch, matchMinute, possessionPercent, tallyText } from '../matchStats';
import { seriesPlayed, seriesText } from '../social';
import { shootoutTally } from '../sim/fouls';
import type { GameState, GoalRecord, MatchStats, ShootoutRecord, TeamId } from '../sim/types';
import type { MatchScene } from './MatchScene';
import { playerName, playerNameById, readableColor, shirtNumber, squadPlayerById, teamStyle } from './teamStyle';
import { button, Focus, label, UI_COLORS, type Button } from './ui';

const CX = GAME_WIDTH / 2;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Full-time screen, drawn over the match: score, stats, goals with times, Rematch and Menu. */
export class ResultsScene extends Phaser.Scene {
  private match!: MatchScene;
  private rematchBtn!: Button;
  private note!: Phaser.GameObjects.Text;
  private statsLayer!: Phaser.GameObjects.Container;
  private drawnKey: string | null = null;
  private focus!: Focus;
  private score!: Phaser.GameObjects.Text;
  private verdict!: Phaser.GameObjects.Text;
  private series!: Phaser.GameObjects.Text;
  private resetSeries!: Button;
  private lobbyBtn!: Button;

  constructor() {
    super('ResultsScene');
  }

  create(): void {
    this.match = this.scene.get('MatchScene') as MatchScene;
    this.drawnKey = null;
    this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setInteractive();
    this.add.rectangle(CX, GAME_HEIGHT / 2, 900, 700, 0x14361c, 0.97).setStrokeStyle(4, 0xffffff, 0.8);
    label(this, CX, 100, 54, UI_COLORS.text, true).setText('FULL TIME').setStroke('#000000', 6);
    this.score = label(this, CX, 175, 56, UI_COLORS.text, true).setStroke('#000000', 6);
    this.verdict = label(this, CX, 222, 26, UI_COLORS.warn, true);
    this.series = label(this, CX, 254, 19, UI_COLORS.muted, true);
    this.statsLayer = this.add.container(0, 0);

    const online = this.match.isOnline();
    // Online: Rematch · Lobby (the same room again, with the series score kept) · Menu; offline: Rematch · Menu.
    this.rematchBtn = button(this, online ? CX - 290 : CX - 150, 700, 'Rematch', () => this.rematch(), { width: online ? 270 : 230 });
    this.lobbyBtn = button(this, CX, 700, 'Back to lobby', () => this.match.backToLobby(), { width: 220, secondary: true }).setVisible(online);
    const menu = button(this, online ? CX + 290 : CX + 150, 700, 'Menu', () => this.match.quit(), { width: online ? 220 : 230, secondary: true });
    this.resetSeries = button(this, CX + 330, 254, 'Reset series', () => this.match.resetSeries(), { size: 16, width: 140, secondary: true }).setVisible(false);
    this.note = label(this, CX, 752, 18, UI_COLORS.muted).setWordWrapWidth(800);
    if (online) this.note.setText('A rematch starts when both players ask for one');
    this.focus = new Focus(this, [{ button: this.rematchBtn }, { button: this.lobbyBtn }, { button: this.resetSeries }, { button: menu }]);
    this.input.keyboard?.on('keydown-ESC', () => this.match.quit());
  }

  private rematch(): void {
    const r = this.match.rematch();
    if (!r) {
      this.match.restartMatch();
      return;
    }
    this.match.setRematch(!r.mine); // click again to take it back
  }

  update(): void {
    const state = this.match.getState();
    this.score.setText(`${teamStyle(0).name} ${state.score[0]} – ${state.score[1]} ${teamStyle(1).name}`);
    const stats = this.match.stats();
    this.verdict.setText(verdictText(state, stats?.shootout ?? state.shootout));

    // The stats object is a fresh copy every tick, so compare what is in it.
    const view = this.match.onlineView();
    const series = view?.lobby.series;
    const key = stats ? JSON.stringify([stats, series, playerName(0), playerName(1)]) : '';
    // The series score (online): your own count first, then who is who.
    const played = !!series && seriesPlayed(series) > 0;
    this.series.setText(view && series && played ? seriesText(series, view.role, [myName(view), theirName(view)]) : '');
    this.resetSeries.setVisible(played);
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.drawStats(stats, state);
    }

    const r = this.match.rematch();
    const ended = this.match.isEnded();
    if (r) {
      this.rematchBtn.setEnabled(!ended);
      this.lobbyBtn.setEnabled(!ended);
      this.rematchBtn.setLabel(r.mine ? 'Waiting… (click to cancel)' : r.theirs ? 'Accept rematch' : 'Rematch');
      this.note.setText(ended ? 'The other player has left, so there is no rematch' : r.theirs && !r.mine ? 'Your opponent wants a rematch!' : r.mine ? 'Waiting for your opponent to accept…' : 'A rematch starts when both players ask for one');
    }
    this.focus.refresh();
  }

  private drawStats(stats: MatchStats | null, state: GameState): void {
    const { halfLength, players } = state;
    this.statsLayer.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.statsLayer.add(o);
    };
    const row = (y: number, left: string, mid: string, right: string, color = UI_COLORS.text): void => {
      add(label(this, CX - 270, y, 28, color, true).setText(left));
      add(label(this, CX, y, 22, UI_COLORS.muted).setText(mid));
      add(label(this, CX + 270, y, 28, color, true).setText(right));
    };
    // Team headers in kit colours.
    for (const t of [0, 1] as const) {
      add(label(this, CX + (t ? 270 : -270), 285, 24, hex(readableColor(t)), true).setText(teamStyle(t).name.toUpperCase()).setStroke('#000000', 4));
    }
    if (!stats) {
      add(label(this, CX, 400, 24, UI_COLORS.muted).setText('Collecting the match statistics…'));
      return;
    }
    const [ph, pa] = possessionPercent(stats.possession);
    const perTeam = (f: (t: TeamId) => string): [string, string] => [f(0), f(1)];
    const lines: { mid: string; vals: [string, string] }[] = [
      { mid: 'Shots', vals: [String(stats.shots[0]), String(stats.shots[1])] },
      { mid: 'Possession', vals: [`${ph}%`, `${pa}%`] },
      { mid: 'Fouls', vals: [String(stats.fouls[0]), String(stats.fouls[1])] },
    ];
    if (stats.cards.length) lines.push({ mid: 'Cards', vals: perTeam((t) => cardsText(stats, t)) });
    if (stats.penalties.length) lines.push({ mid: 'Penalties scored', vals: perTeam((t) => penaltiesText(stats, t)) });
    if (stats.shootout) {
      const { goals, taken } = shootoutTally(stats.shootout);
      lines.push({ mid: 'Shoot-out', vals: perTeam((t) => `${goals[t]}/${taken[t]}`) });
    }
    lines.forEach((l, i) => row(322 + i * 32, l.vals[0], l.mid, l.vals[1]));

    // The human players' stat lines (T21), one per team with a human who has a name (offline: you).
    let y = 322 + lines.length * 32 + 8;
    for (const t of [0, 1] as const) {
      const who = playerName(t);
      if (!who || !stats.humans) continue;
      add(label(this, CX, y, 18, hex(readableColor(t))).setText(`Manager ${who}:  ${tallyText(stats.humans[t])}`).setStroke('#000000', 3));
      y += 25;
    }

    // Man of the match: goals, assists, saves and tackles won.
    const mvp = manOfTheMatch(stats, (id) => players[id]?.team ?? 0, winnerOf(state, stats));
    if (mvp) {
      const p = players[mvp.player];
      const team = (p?.team ?? 0) as TeamId;
      y += 6;
      add(label(this, CX, y, 22, UI_COLORS.warn, true).setText(`★ MAN OF THE MATCH:  ${p ? `${squadPlayerById(p.id).name} #${shirtNumber(p)}` : '?'} · ${teamStyle(team).name}${p?.role === 'keeper' ? ' (GK)' : ''}`).setStroke('#000000', 4));
      add(label(this, CX, y + 25, 17, UI_COLORS.muted).setText(tallyText(stats.players[mvp.player])));
      y += 52;
    }

    const goalsY = y + 14;
    add(label(this, CX, goalsY, 22, UI_COLORS.warn, true).setText('GOALS'));
    if (stats.goals.length === 0) {
      add(label(this, CX, goalsY + 34, 20, UI_COLORS.muted).setText('No goals'));
      return;
    }
    // As many goals as fit are listed, one per line, oldest first (the rest are summarised).
    const shown = stats.goals.slice(0, Math.max(1, Math.floor((660 - goalsY) / 24) - 1));
    shown.forEach((g: GoalRecord, i: number) => {
      const gy = goalsY + 32 + i * 24;
      const minute = `${matchMinute(g.half, g.clock, halfLength)}'`;
      const who = g.player >= 0 ? `${playerNameById(g.player)} · ` : '';
      const text = `${minute}  ${who}${teamStyle(g.team).name}${g.ownGoal ? ' (own goal)' : ''}`;
      add(label(this, CX, gy, 19, hex(readableColor(g.team))).setText(text).setStroke('#000000', 3));
    });
    if (stats.goals.length > shown.length) add(label(this, CX, goalsY + 32 + shown.length * 24, 17, UI_COLORS.muted).setText(`…and ${stats.goals.length - shown.length} more`));
  }
}

const myName = (v: { role: 'host' | 'guest'; lobby: { names: [string, string] } }): string => v.lobby.names[v.role === 'host' ? 0 : 1];
const theirName = (v: { role: 'host' | 'guest'; lobby: { names: [string, string] } }): string => v.lobby.names[v.role === 'host' ? 1 : 0];

/** The team that won the match (by score, else the shoot-out), or -1 for a draw. */
function winnerOf(state: Pick<GameState, 'score'>, stats: MatchStats): TeamId | -1 {
  const [a, b] = state.score;
  if (a !== b) return a > b ? 0 : 1;
  const w = stats.shootout?.winner;
  return w === 0 || w === 1 ? w : -1;
}

/** "Home win!", "It ends in a draw", or, after a shoot-out, "Home win 4–3 on penalties". */
export function verdictText(state: Pick<GameState, 'score'>, shootout: ShootoutRecord | null | undefined): string {
  const [a, b] = state.score;
  if (a !== b) return `${teamStyle(a > b ? 0 : 1).name} win!`;
  if (shootout && shootout.winner >= 0) {
    const { goals } = shootoutTally(shootout);
    const w = shootout.winner as TeamId;
    return `${teamStyle(w).name} win ${goals[w]}–${goals[1 - w]} on penalties`;
  }
  return 'It ends in a draw';
}

/** "1 yellow, 1 red" for a team, or "–". */
function cardsText(stats: MatchStats, team: TeamId): string {
  const y = stats.cards.filter((c) => c.team === team && c.card === 'yellow').length;
  const r = stats.cards.filter((c) => c.team === team && c.card === 'red').length;
  const parts = [y ? `${y} yellow` : '', r ? `${r} red` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : '–';
}

/** "1/2" penalties scored of taken, or "–". */
function penaltiesText(stats: MatchStats, team: TeamId): string {
  const taken = stats.penalties.filter((p) => p.team === team);
  return taken.length ? `${taken.filter((p) => p.scored).length}/${taken.length}` : '–';
}

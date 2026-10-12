import Phaser from 'phaser';
import {
  CENTRE_CIRCLE_RADIUS,
  COLORS,
  CONTROL_RING_COLOR,
  GAME_HEIGHT,
  GOAL_DEPTH,
  GOAL_WIDTH,
  LINE_THICKNESS,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
  AI_VS_AI,
  DEBUG_CLICK_KICK,
  DEBUG_KICK_SPEED,
  POST_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  GAME_WIDTH,
} from '../config';
import { KeyboardInput } from '../input/keyboard';
import { controlsSummary, settings } from '../settings';
import { NEUTRAL_INPUT } from '../sim/simulation';
import { randomOpponent, type Look } from '../teams';
import { setTeamLooks, teamStyle } from './teamStyle';
import { BOUNDARY } from '../sim/physics';
import { roleOf } from '../sim/ai';
import type { Difficulty, GameState, InputFrame, MatchStats, PlayerState, TeamId } from '../sim/types';
import { GuestLobby, GuestMatch } from '../net/client';
import { HostLobby, HostMatch } from '../net/host';
import type { MatchDriver, NetOverlay } from '../net/match';
import type { Lobby } from '../net/peer';

/** How MatchScene is started: offline vs the AI by default; online (from the lobby) with the player's team. */
export interface MatchSceneData {
  /** The team the local player controls (default home). */
  humanTeam?: TeamId;
  seed?: number;
  /** The online lobby connection: the host runs the match and the guest follows it over this. */
  online?: Lobby;
  /** Seconds per half (default: the match length in the settings). Online, the host's setting. */
  halfLength?: number;
  /** Both teams' names and kits, indexed by team (default: the saved look against a random opponent). */
  looks?: [Look, Look];
}

/** How long the final whistle is left alone before the results screen appears. */
const RESULTS_DELAY = 1.2;

const ROLE_LABEL = { keeper: 'GK', defender: 'DEF', attacker: 'ATT' } as const;

/** Match options from the URL: ?aivsai to spectate, ?difficulty=easy|normal|hard for the AI. */
function urlOptions(): { aiVsAi: boolean; difficulty?: Difficulty } {
  const q = new URLSearchParams(window.location.search);
  const d = q.get('difficulty');
  const difficulty = d === 'easy' || d === 'normal' || d === 'hard' ? d : undefined;
  return { aiVsAi: AI_VS_AI || q.has('aivsai'), difficulty };
}

/**
 * Draws the match. Reads state only; never changes it. The match itself is advanced by a driver: a HostMatch
 * (offline, or the online host: the only real simulation) or, for the online guest, a GuestMatch.
 */
export class MatchScene extends Phaser.Scene {
  private driver!: MatchDriver;
  private keyboard!: KeyboardInput;
  private dynamic!: Phaser.GameObjects.Graphics;
  private readonly numberLabels: Phaser.GameObjects.Text[] = [];
  private aiVsAi = false;
  /** AI debug overlay (toggle with F2 or `): each AI player's role and intent, plus team modes. */
  private debugAi = false;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private readonly debugLabels: Phaser.GameObjects.Text[] = [];
  private debugTeams!: Phaser.GameObjects.Text;
  private humanTeam: TeamId = 0;
  private seed?: number;
  private online?: Lobby;
  private halfLength = 180;
  private looks!: [Look, Look];
  /** The pause menu is open (offline this also stops the match; online the match carries on without your input). */
  private pauseOpen = false;
  private frozen = false;
  private resultsShown = false;
  private fullTimeFor = 0;
  private onlineLabel?: Phaser.GameObjects.Text;
  /** Network debug overlay (toggle with F3): ping, snapshot rate, buffer, loss. */
  private debugNet = false;
  private netText!: Phaser.GameObjects.Text;

  constructor() {
    super('MatchScene');
  }

  init(data: MatchSceneData = {}): void {
    this.humanTeam = data.humanTeam ?? 0;
    this.online = data.online;
    // Offline matches get a fresh seed each time, so the AI doesn't play out the same match every time.
    this.seed = data.seed ?? (data.online ? undefined : Math.floor(Math.random() * 0x7fffffff));
    this.halfLength = data.halfLength ?? settings.halfMinutes * 60;
    this.looks = data.looks ?? [settings.look, randomOpponent(settings.look)];
    setTeamLooks(this.looks);
    this.pauseOpen = false;
    this.frozen = false;
    this.resultsShown = false;
    this.fullTimeFor = 0;
  }

  create(): void {
    const opts = urlOptions();
    this.aiVsAi = !this.online && opts.aiVsAi;
    this.driver = this.createDriver(opts.difficulty);
    this.drawPitch();
    this.dynamic = this.add.graphics();
    this.createDebugOverlay();
    this.numberLabels.length = 0;
    for (const team of [0, 1]) {
      const label = this.add
        .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5, 1)
        .setDepth(10)
        .setVisible(false);
      this.numberLabels[team] = label;
    }

    this.keyboard = new KeyboardInput(settings.bindings);
    this.scene.launch('HudScene');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyboard.dispose();
      for (const key of ['HudScene', 'PauseScene', 'ResultsScene']) this.scene.stop(key);
      this.online?.leave();
    });
    // Esc: the pause menu (or, once the match is over for good, back to the menu).
    this.input.keyboard?.on('keydown-ESC', (e: KeyboardEvent) => {
      if (e.repeat || this.resultsShown) return; // the results screen has its own Esc
      if (this.driver.overlay(performance.now())?.ended) this.quit();
      else if (this.pauseOpen) this.closePause();
      else this.openPause();
    });
    if (settings.showControls) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 14, controlsSummary(settings.bindings), { fontFamily: 'sans-serif', fontSize: '14px', color: '#d8e4dc', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(30);
    }
    this.onlineLabel = this.online
      ? this.add
          .text(PITCH_MARGIN, GAME_HEIGHT - PITCH_MARGIN / 2 - 8, '', { fontFamily: 'sans-serif', fontSize: '15px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 6, y: 3 } })
          .setOrigin(0, 0.5)
          .setDepth(30)
      : undefined;
    this.netText = this.add
      .text(GAME_WIDTH - 8, GAME_HEIGHT - 8, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#000000b0', padding: { x: 6, y: 4 } })
      .setOrigin(1, 1)
      .setDepth(40)
      .setVisible(false);
    // F3 (captured, so the browser's find bar doesn't open) or N.
    this.input.keyboard?.addCapture('F3');
    const toggleNet = (): void => {
      this.debugNet = !this.debugNet;
    };
    this.input.keyboard?.on('keydown-F3', toggleNet);
    this.input.keyboard?.on('keydown-N', toggleNet);

    if (DEBUG_CLICK_KICK) {
      // Debug only, render-side: pokes the ball towards the pointer. Off by default (see config.ts).
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.driver.online) return;
        const { ball } = this.driver.state;
        const dx = pointer.worldX - ball.pos.x;
        const dy = pointer.worldY - ball.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        ball.vel.x = (dx / d) * DEBUG_KICK_SPEED;
        ball.vel.y = (dy / d) * DEBUG_KICK_SPEED;
      });
    }
  }

  private createDriver(difficulty?: Difficulty): MatchDriver {
    const online = this.online;
    const level = difficulty ?? settings.difficulty;
    const halfLength = this.halfLength;
    if (online instanceof HostLobby) return new HostMatch({ localTeam: this.humanTeam, seed: this.seed, difficulty: level, halfLength, lobby: online });
    if (online instanceof GuestLobby) return new GuestMatch(online, this.humanTeam, halfLength, this.seed);
    return new HostMatch({ localTeam: this.aiVsAi ? null : this.humanTeam, seed: this.seed, difficulty: level, halfLength });
  }

  /** Read-only access for the HUD. */
  getState(): GameState {
    return this.driver.state;
  }

  isOnline(): boolean {
    return this.driver.online;
  }

  /** Connection trouble / match ended online (drawn by the HUD), or null. */
  netOverlay(): NetOverlay | null {
    return this.driver.overlay(performance.now());
  }

  /** Offline "Rematch": a brand-new match. (Online, a rematch starts through the lobby when both players ask.) */
  restartMatch(): void {
    this.driver.restart();
  }

  stats(): MatchStats | null {
    return this.driver.stats();
  }

  rematch(): { mine: boolean; theirs: boolean } | null {
    return this.driver.rematch();
  }

  setRematch(want: boolean): void {
    this.driver.setRematch(want);
  }

  /** Is the match over for good (the other player left, or the connection was lost)? */
  isEnded(): boolean {
    return !!this.driver.overlay(performance.now())?.ended;
  }

  /** The pause menu. Offline it freezes the match. Online it can't: your friend is still playing, so the match keeps going and only your input is ignored. */
  openPause(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this.frozen = !this.driver.online;
    this.scene.launch('PauseScene', { online: this.driver.online });
  }

  closePause(): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.frozen = false;
    this.scene.stop('PauseScene');
  }

  /** Leave the match (online: the other player is told) and go back to the title screen. */
  quit(): void {
    this.scene.start('MenuScene');
  }

  /** Local input for one tick: nothing while a menu is open (the keys belong to the menu then). */
  private sampleInput(): InputFrame {
    const frame = this.keyboard.sample();
    return this.pauseOpen || this.resultsShown ? { ...NEUTRAL_INPUT, seq: frame.seq } : frame;
  }

  /** Full time: after a moment, the results screen goes over the match; it closes itself when a new match starts. */
  private watchFullTime(dt: number): void {
    const over = this.driver.state.phase === 'full-time';
    if (!over) {
      this.fullTimeFor = 0;
      if (this.resultsShown) {
        this.resultsShown = false;
        this.scene.stop('ResultsScene');
      }
      return;
    }
    this.fullTimeFor += dt;
    if (!this.resultsShown && this.fullTimeFor >= RESULTS_DELAY) {
      this.closePause();
      this.resultsShown = true;
      this.scene.launch('ResultsScene');
    }
  }

  update(_time: number, delta: number): void {
    const now = performance.now();
    if (!this.frozen) this.driver.advance(delta / 1000, () => this.sampleInput(), now);
    this.watchFullTime(delta / 1000);
    this.drawState(this.driver.state);
    this.drawOnlineStatus();
    this.netText.setVisible(this.debugNet);
    if (this.debugNet) this.netText.setText(this.driver.debugLines(now).join('\n'));
  }

  private drawOnlineStatus(): void {
    if (!this.online || !this.onlineLabel) return;
    const v = this.online.view;
    const link =
      v.status === 'connected'
        ? `ping ${v.pingMs === null ? '…' : Math.round(v.pingMs)} ms`
        : v.status === 'reconnecting'
          ? 'reconnecting…'
          : `disconnected${v.error ? ` (${v.error.title.toLowerCase()})` : ''}`;
    this.onlineLabel.setText(`ONLINE · you are ${teamStyle(this.humanTeam).name} (${v.role}) · ${link} · F3: network info · Esc: menu`);
  }

  private createDebugOverlay(): void {
    this.debugGfx = this.add.graphics().setDepth(20);
    this.debugLabels.length = 0;
    const style = { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 2, y: 1 } };
    for (let i = 0; i < this.driver.state.players.length; i++) {
      this.debugLabels.push(this.add.text(0, 0, '', style).setOrigin(0.5, 0).setDepth(21).setVisible(false));
    }
    this.debugTeams = this.add.text(8, 6, '', { ...style, fontSize: '13px' }).setDepth(21).setVisible(false);
    const toggle = (): void => {
      this.debugAi = !this.debugAi;
    };
    this.input.keyboard?.on('keydown-F2', toggle);
    this.input.keyboard?.on('keydown-BACKTICK', toggle);
  }

  /** Read-only: role, intent and target of every AI player, and each team's mode and counters. */
  private drawDebugOverlay(state: GameState): void {
    const g = this.debugGfx;
    g.clear();
    const on = this.debugAi;
    this.debugTeams.setVisible(on);
    // The guest's copy of the state has no AI memory: the AI only runs on the host.
    const guest = this.online?.view.role === 'guest';
    if (on && guest) this.debugTeams.setText('AI debug (F2) is only available on the host, where the AI runs');
    state.players.forEach((p, i) => {
      const label = this.debugLabels[i];
      label.setVisible(on && !guest);
      if (!on || guest) return;
      const m = state.ai.players[i];
      label.setText(`${ROLE_LABEL[roleOf(p)]} ${m.intent}`).setPosition(p.pos.x, p.pos.y + p.radius + 4);
      if (m.intent === 'human') return;
      g.lineStyle(1, teamStyle(p.team).kit, 0.9);
      g.lineBetween(p.pos.x, p.pos.y, m.target.x, m.target.y);
      g.strokeCircle(m.target.x, m.target.y, 4);
      if (m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear' || m.intent === 'distribute') {
        g.lineStyle(2, 0xffff00, 0.8);
        g.lineBetween(state.ball.pos.x, state.ball.pos.y, m.kickTarget.x, m.kickTarget.y);
      }
    });
    if (on && !guest) {
      const t = state.ai.teams;
      const line = (i: 0 | 1): string =>
        `${teamStyle(i).name} [${state.ai.difficulty[i]}] ${t[i].mode.padEnd(13)} passes ${t[i].passes}  shots ${t[i].shots}  tackles ${t[i].tackles}  saves ${t[i].saves}`;
      this.debugTeams.setText(`${line(0)}\n${line(1)}\nAI debug (F2)`);
    }
  }

  /** Read-only: draws the given state. */
  private drawState(state: GameState): void {
    const g = this.dynamic;
    g.clear();
    g.fillStyle(0xffffff, 1);
    for (const post of BOUNDARY.posts) g.fillCircle(post.pos.x, post.pos.y, POST_RADIUS);
    for (const p of state.players) this.drawPlayer(g, p, state.controlled[p.team] === p.id);
    for (const team of [0, 1] as const) {
      const cur = state.controlled[team] >= 0 ? state.players[state.controlled[team]] : undefined;
      const label = this.numberLabels[team];
      label.setVisible(!!cur);
      if (cur) label.setText(String(cur.number)).setPosition(cur.pos.x, cur.pos.y - cur.radius - 10);
    }
    this.drawDebugOverlay(state);
    // Ball: soft shadow, white body, dark outline.
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(state.ball.pos.x + 2, state.ball.pos.y + 3, state.ball.radius);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
    g.lineStyle(2, 0x222222, 1);
    g.strokeCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, p: PlayerState, controlled: boolean): void {
    const { x, y } = p.pos;
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(x + 2, y + 3, p.radius);
    const team = teamStyle(p.team);
    g.fillStyle(p.tackleTimer > 0 ? 0xffffff : p.role === 'keeper' ? team.keeper : team.kit, p.tackleTimer > 0 ? 0.75 : 1);
    g.fillCircle(x, y, p.radius);
    g.lineStyle(2, team.outline, 1);
    g.strokeCircle(x, y, p.radius);
    if (controlled) {
      g.lineStyle(3, CONTROL_RING_COLOR, 1);
      g.strokeCircle(x, y, p.radius + 5);
    }
    // Facing indicator: a line and a dot at the front edge.
    const fx = Math.cos(p.facing);
    const fy = Math.sin(p.facing);
    g.lineStyle(3, COLORS.playerFacing, 1);
    g.lineBetween(x, y, x + fx * p.radius, y + fy * p.radius);
    g.fillStyle(COLORS.playerFacing, 1);
    g.fillCircle(x + fx * p.radius * 0.75, y + fy * p.radius * 0.75, 3);
    // Shot power bar under the player while charging.
    if (p.charge > 0) {
      const w = 36;
      const h = 6;
      const frac = Math.min(1, p.charge / SHOT_MAX_CHARGE_TIME);
      const bx = x - w / 2;
      const by = y + p.radius + 6;
      g.fillStyle(0x000000, 0.6);
      g.fillRect(bx - 1, by - 1, w + 2, h + 2);
      g.fillStyle(frac >= 1 ? 0xff4040 : 0xffd23f, 1);
      g.fillRect(bx, by, w * frac, h);
    }
  }

  private drawPitch(): void {
    const g = this.add.graphics();
    const left = PITCH_MARGIN;
    const top = PITCH_MARGIN;
    const right = left + PITCH_WIDTH;
    const bottom = top + PITCH_HEIGHT;
    const midX = left + PITCH_WIDTH / 2;
    const midY = top + PITCH_HEIGHT / 2;

    // Grass
    g.fillStyle(COLORS.grass, 1);
    g.fillRect(0, 0, PITCH_WIDTH + PITCH_MARGIN * 2, PITCH_HEIGHT + PITCH_MARGIN * 2);

    // Lines
    g.lineStyle(LINE_THICKNESS, COLORS.line, 1);
    g.strokeRect(left, top, PITCH_WIDTH, PITCH_HEIGHT);
    g.lineBetween(midX, top, midX, bottom);
    g.strokeCircle(midX, midY, CENTRE_CIRCLE_RADIUS);
    g.fillStyle(COLORS.line, 1);
    g.fillCircle(midX, midY, 5);

    // Penalty boxes
    const boxTop = midY - PENALTY_BOX_HEIGHT / 2;
    g.strokeRect(left, boxTop, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT);
    g.strokeRect(right - PENALTY_BOX_WIDTH, boxTop, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT);

    // Goals (open towards the pitch, drawn outside the goal lines)
    const goalTop = midY - GOAL_WIDTH / 2;
    g.fillStyle(COLORS.goalNet, 0.25);
    g.fillRect(left - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_WIDTH);
    g.fillRect(right, goalTop, GOAL_DEPTH, GOAL_WIDTH);
    g.lineStyle(LINE_THICKNESS, COLORS.line, 1);
    g.strokeRect(left - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_WIDTH);
    g.strokeRect(right, goalTop, GOAL_DEPTH, GOAL_WIDTH);
  }
}
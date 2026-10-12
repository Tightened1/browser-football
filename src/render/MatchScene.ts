import Phaser from 'phaser';
import {
  CENTRE_CIRCLE_RADIUS,
  COLORS,
  CONTROL_RING_COLOR,
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
  SIM_DT,
  TEAMS,
} from '../config';
import { KeyboardInput } from '../input/keyboard';
import { BOUNDARY } from '../sim/physics';
import { createMatchState, step } from '../sim/simulation';
import { roleOf } from '../sim/ai';
import type { Difficulty, GameState, InputFrame, PlayerState } from '../sim/types';

const ROLE_LABEL = { keeper: 'GK', defender: 'DEF', attacker: 'ATT' } as const;

/** Match options from the URL: ?aivsai to spectate, ?difficulty=easy|normal|hard for the AI. */
function urlOptions(): { aiVsAi: boolean; difficulty?: Difficulty } {
  const q = new URLSearchParams(window.location.search);
  const d = q.get('difficulty');
  const difficulty = d === 'easy' || d === 'normal' || d === 'hard' ? d : undefined;
  return { aiVsAi: AI_VS_AI || q.has('aivsai'), difficulty };
}

/** Draws the match. Reads state only; never changes it. */
export class MatchScene extends Phaser.Scene {
  private state: GameState = createMatchState();
  private options: { aiVsAi: boolean; difficulty?: Difficulty } = { aiVsAi: false };
  private accumulator = 0;
  private keyboard!: KeyboardInput;
  private dynamic!: Phaser.GameObjects.Graphics;
  private readonly numberLabels: Phaser.GameObjects.Text[] = [];
  private aiVsAi = false;
  /** AI debug overlay (toggle with F2 or `): each AI player's role and intent, plus team modes. */
  private debugAi = false;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private readonly debugLabels: Phaser.GameObjects.Text[] = [];
  private debugTeams!: Phaser.GameObjects.Text;

  constructor() {
    super('MatchScene');
  }

  create(): void {
    const opts = urlOptions();
    this.options = opts;
    this.aiVsAi = opts.aiVsAi;
    this.state = this.newState();
    this.accumulator = 0;
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

    this.keyboard = new KeyboardInput();
    this.scene.launch('HudScene');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyboard.dispose();
      this.scene.stop('HudScene');
    });

    if (DEBUG_CLICK_KICK) {
      // Debug only, render-side: pokes the ball towards the pointer. Off by default (see config.ts).
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const { ball } = this.state;
        const dx = pointer.worldX - ball.pos.x;
        const dy = pointer.worldY - ball.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        ball.vel.x = (dx / d) * DEBUG_KICK_SPEED;
        ball.vel.y = (dy / d) * DEBUG_KICK_SPEED;
      });
    }
  }

  private newState(): GameState {
    const d = this.options.difficulty;
    return createMatchState({ aiVsAi: this.options.aiVsAi, difficulty: d && [d, d] });
  }

  /** Read-only access for the HUD. */
  getState(): GameState {
    return this.state;
  }

  /** "Play again": a brand-new match. */
  restartMatch(): void {
    this.state = this.newState();
    this.accumulator = 0;
  }

  update(_time: number, delta: number): void {
    // Fixed 60 Hz timestep; clamp so a stalled tab doesn't cause a spiral of catch-up steps.
    this.accumulator += Math.min(delta / 1000, 0.25);
    while (this.accumulator >= SIM_DT) {
      this.state = step(this.state, this.collectInputs(), SIM_DT);
      this.accumulator -= SIM_DT;
    }
    this.drawState(this.state);
  }

  private collectInputs(): InputFrame[] {
    const local = this.keyboard.sample();
    return this.aiVsAi ? [] : [local];
  }

  private createDebugOverlay(): void {
    this.debugGfx = this.add.graphics().setDepth(20);
    this.debugLabels.length = 0;
    const style = { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 2, y: 1 } };
    for (let i = 0; i < this.state.players.length; i++) {
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
    state.players.forEach((p, i) => {
      const label = this.debugLabels[i];
      label.setVisible(on);
      if (!on) return;
      const m = state.ai.players[i];
      label.setText(`${ROLE_LABEL[roleOf(p)]} ${m.intent}`).setPosition(p.pos.x, p.pos.y + p.radius + 4);
      if (m.intent === 'human') return;
      g.lineStyle(1, TEAMS[p.team].kit, 0.9);
      g.lineBetween(p.pos.x, p.pos.y, m.target.x, m.target.y);
      g.strokeCircle(m.target.x, m.target.y, 4);
      if (m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear' || m.intent === 'distribute') {
        g.lineStyle(2, 0xffff00, 0.8);
        g.lineBetween(state.ball.pos.x, state.ball.pos.y, m.kickTarget.x, m.kickTarget.y);
      }
    });
    if (on) {
      const t = state.ai.teams;
      const line = (i: 0 | 1): string =>
        `${TEAMS[i].name} [${state.ai.difficulty[i]}] ${t[i].mode.padEnd(13)} passes ${t[i].passes}  shots ${t[i].shots}  tackles ${t[i].tackles}  saves ${t[i].saves}`;
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
    const team = TEAMS[p.team];
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
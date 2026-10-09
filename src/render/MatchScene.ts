import Phaser from 'phaser';
import {
  CENTRE_CIRCLE_RADIUS,
  COLORS,
  GOAL_DEPTH,
  GOAL_WIDTH,
  LINE_THICKNESS,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
  DEBUG_CLICK_KICK,
  DEBUG_KICK_SPEED,
  POST_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SIM_DT,
} from '../config';
import { KeyboardInput } from '../input/keyboard';
import { BOUNDARY } from '../sim/physics';
import { createInitialState, step } from '../sim/simulation';
import type { GameState, InputFrame, PlayerState } from '../sim/types';

/** Draws the match. Reads state only; never changes it. */
export class MatchScene extends Phaser.Scene {
  private state: GameState = createInitialState();
  private accumulator = 0;
  private keyboard!: KeyboardInput;
  private dynamic!: Phaser.GameObjects.Graphics;

  constructor() {
    super('MatchScene');
  }

  create(): void {
    this.state = createInitialState();
    this.accumulator = 0;
    this.drawPitch();
    this.dynamic = this.add.graphics();

    this.keyboard = new KeyboardInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.keyboard.dispose());

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
    return [this.keyboard.sample()];
  }

  /** Read-only: draws the given state. */
  private drawState(state: GameState): void {
    const g = this.dynamic;
    g.clear();
    g.fillStyle(0xffffff, 1);
    for (const post of BOUNDARY.posts) g.fillCircle(post.pos.x, post.pos.y, POST_RADIUS);
    for (const p of state.players) this.drawPlayer(g, p);
    // Ball: soft shadow, white body, dark outline.
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(state.ball.pos.x + 2, state.ball.pos.y + 3, state.ball.radius);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
    g.lineStyle(2, 0x222222, 1);
    g.strokeCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, p: PlayerState): void {
    const { x, y } = p.pos;
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(x + 2, y + 3, p.radius);
    g.fillStyle(p.tackleTimer > 0 ? 0x6fa3f5 : COLORS.player, 1);
    g.fillCircle(x, y, p.radius);
    g.lineStyle(2, COLORS.playerOutline, 1);
    g.strokeCircle(x, y, p.radius);
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
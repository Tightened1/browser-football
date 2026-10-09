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
  POST_RADIUS,
  SIM_DT,
} from '../config';
import { BOUNDARY } from '../sim/physics';
import { createInitialState, step } from '../sim/simulation';
import type { GameState, InputFrame, Vec2 } from '../sim/types';

/** Draws the match. Reads state only; never changes it. */
export class MatchScene extends Phaser.Scene {
  private state: GameState = createInitialState();
  private accumulator = 0;
  private seq = 0;
  private pendingKick: Vec2 | null = null;
  private dynamic!: Phaser.GameObjects.Graphics;

  constructor() {
    super('MatchScene');
  }

  create(): void {
    this.state = createInitialState();
    this.accumulator = 0;
    this.drawPitch();
    this.dynamic = this.add.graphics();

    if (DEBUG_CLICK_KICK) {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.pendingKick = { x: pointer.worldX, y: pointer.worldY };
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
    const input: InputFrame = {
      seq: this.seq++,
      moveX: 0,
      moveY: 0,
      pass: false,
      shoot: false,
      tackle: false,
      switchPlayer: false,
      kickTarget: this.pendingKick,
    };
    this.pendingKick = null;
    return [input];
  }

  /** Read-only: draws the given state. */
  private drawState(state: GameState): void {
    const g = this.dynamic;
    g.clear();
    g.fillStyle(0xffffff, 1);
    for (const post of BOUNDARY.posts) g.fillCircle(post.pos.x, post.pos.y, POST_RADIUS);
    // Ball: soft shadow, white body, dark outline.
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(state.ball.pos.x + 2, state.ball.pos.y + 3, state.ball.radius);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
    g.lineStyle(2, 0x222222, 1);
    g.strokeCircle(state.ball.pos.x, state.ball.pos.y, state.ball.radius);
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
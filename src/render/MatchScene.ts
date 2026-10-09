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
} from '../config';

/** Draws the match. Reads state only; never changes it. */
export class MatchScene extends Phaser.Scene {
  constructor() {
    super('MatchScene');
  }

  create(): void {
    this.drawPitch();
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
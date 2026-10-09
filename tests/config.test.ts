import { describe, expect, it } from 'vitest';
import { HALF_LENGTH_SECONDS, SIM_DT, SIM_HZ } from '../src/config';

describe('config', () => {
  it('uses a 60 Hz fixed timestep and 3 minute halves', () => {
    expect(SIM_HZ).toBe(60);
    expect(SIM_DT).toBeCloseTo(1 / 60);
    expect(HALF_LENGTH_SECONDS).toBe(180);
  });
});
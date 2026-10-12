// The colours and names the current match is drawn with (chosen on the team picker; online, each player's own pick).
import { TEAMS } from '../config';
import { readableOn, teamStyles, type Look, type TeamStyle } from '../teams';

let styles: [TeamStyle, TeamStyle] = [{ ...TEAMS[0] }, { ...TEAMS[1] }];

/** Called when a match starts. `looks` is indexed by team. */
export function setTeamLooks(looks: readonly [Look, Look]): void {
  styles = teamStyles(looks);
}

export function teamStyle(team: 0 | 1): TeamStyle {
  return styles[team];
}

/** The colour to write a team's name in on a dark background. */
export function readableColor(team: 0 | 1): number {
  return readableOn(styles[team]);
}

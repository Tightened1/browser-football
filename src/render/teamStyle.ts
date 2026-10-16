// The colours, names and players the current match is drawn with (chosen on the club picker; online, each player's own pick).
import { PLAYERS_PER_TEAM } from '../config';
import type { ClubPlayer } from '../data/clubs';
import { clubPlayer, DEFAULT_LOOK, readableOn, resolveGuest, teamStyles, type Look, type TeamStyle } from '../teams';

let current: [Look, Look] = [{ ...DEFAULT_LOOK }, resolveGuest(DEFAULT_LOOK, { club: 1, kit: 0 })];
let styles: [TeamStyle, TeamStyle] = teamStyles(current);

/** Called when a match starts. `looks` is indexed by team; `fixed` is the team of the host (whose keeper keeps its shirt in a clash). */
export function setTeamLooks(looks: readonly [Look, Look], fixed: 0 | 1 = 0): void {
  current = [{ ...looks[0] }, { ...looks[1] }];
  styles = teamStyles(current, fixed);
}

export function teamStyle(team: 0 | 1): TeamStyle {
  return styles[team];
}

/** The colour to write a team's name in on a dark background. */
export function readableColor(team: 0 | 1): number {
  return readableOn(styles[team]);
}

/** The real player in a team's formation slot (0 = keeper). */
export function squadPlayer(team: 0 | 1, slot: number): ClubPlayer {
  return clubPlayer(current[team].club, slot);
}

/** The real player behind a player id (team * PLAYERS_PER_TEAM + slot). */
export function squadPlayerById(id: number): ClubPlayer & { team: 0 | 1; slot: number } {
  const team = id >= PLAYERS_PER_TEAM ? 1 : 0;
  const slot = ((id % PLAYERS_PER_TEAM) + PLAYERS_PER_TEAM) % PLAYERS_PER_TEAM;
  return { ...squadPlayer(team, slot), team, slot };
}

/** The shirt number of a player (their real one). */
export const shirtNumber = (p: { team: 0 | 1; slot: number }): number => squadPlayer(p.team, p.slot).number;
/** "Saka" for a player id (or "?" for none). */
export const playerNameById = (id: number): string => (id >= 0 && id < PLAYERS_PER_TEAM * 2 ? squadPlayerById(id).name : '?');

let names: [string, string] = ['', ''];

/** Called when a match starts: the human player's name for each team ('' = nobody, e.g. the AI's team). They are the "managers". */
export function setPlayerNames(next: readonly [string, string]): void {
  names = [next[0], next[1]];
}

/** The human player (manager) of a team ('' if none). */
export function playerName(team: 0 | 1): string {
  return names[team];
}

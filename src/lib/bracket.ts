/** "Final", "Semifinals", "Quarterfinals" or "Round n". Quarterfinals only when the round
 *  really is eight songs or fewer (10 songs open with five matches, which is just Round 1). */
export function roundName(round: number, totalRounds: number, matchesInRound: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2 && matchesInRound <= 4) return 'Quarterfinals';
  return `Round ${round}`;
}

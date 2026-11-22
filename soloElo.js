const K_FACTOR = 32;

export function calculateElo(ratingA, ratingB, winner) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const scoreA = winner === 'A' ? 1 : 0;
  const scoreB = winner === 'B' ? 1 : 0;

  const newRatingA = Math.max(
    0,
    Math.round(ratingA + K_FACTOR * (scoreA - expectedA))
  );

  const newRatingB = Math.max(
    0,
    Math.round(ratingB + K_FACTOR * (scoreB - expectedB))
  );

  return {
    player1: {
      before: ratingA,
      after: newRatingA,
      change: newRatingA - ratingA
    },
    player2: {
      before: ratingB,
      after: newRatingB,
      change: newRatingB - ratingB
    }
  };
}

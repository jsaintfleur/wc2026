export const KNOCKOUT_ROUND_MATCH_NUMBERS = {
  r32: [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
  r16: [89, 90, 91, 92, 93, 94, 95, 96],
  qf: [97, 98, 99, 100],
  sf: [101, 102],
  third: [103],
  final: [104],
} as const;

export type KnockoutStructureRoundKey = keyof typeof KNOCKOUT_ROUND_MATCH_NUMBERS;

export function knockoutMatchRange(matchNumbers: readonly number[]): string {
  if (!matchNumbers.length) return "M TBD";
  const first = matchNumbers[0];
  const last = matchNumbers[matchNumbers.length - 1];
  return first === last ? `M${first}` : `M${first}-M${last}`;
}

export function validateKnockoutMatchNumbers(): string[] {
  const expected: Record<KnockoutStructureRoundKey, { length: number; first: number; last: number }> = {
    r32: { length: 16, first: 73, last: 88 },
    r16: { length: 8, first: 89, last: 96 },
    qf: { length: 4, first: 97, last: 100 },
    sf: { length: 2, first: 101, last: 102 },
    third: { length: 1, first: 103, last: 103 },
    final: { length: 1, first: 104, last: 104 },
  };
  const issues: string[] = [];

  for (const [key, numbers] of Object.entries(KNOCKOUT_ROUND_MATCH_NUMBERS) as [KnockoutStructureRoundKey, readonly number[]][]) {
    const spec = expected[key];
    if (numbers.length !== spec.length) issues.push(`${key} has ${numbers.length} matches, expected ${spec.length}`);
    if (numbers[0] !== spec.first || numbers[numbers.length - 1] !== spec.last) {
      issues.push(`${key} range is ${knockoutMatchRange(numbers)}, expected ${knockoutMatchRange([spec.first, spec.last])}`);
    }
    for (let index = 1; index < numbers.length; index++) {
      if (numbers[index] !== numbers[index - 1] + 1) {
        issues.push(`${key} match numbers are not contiguous at M${numbers[index - 1]}-M${numbers[index]}`);
      }
    }
  }

  const all: number[] = Object.values(KNOCKOUT_ROUND_MATCH_NUMBERS).flat();
  for (let expectedNo = 73; expectedNo <= 104; expectedNo++) {
    if (!all.includes(expectedNo)) issues.push(`M${expectedNo} is missing from knockout structure`);
  }

  return issues;
}

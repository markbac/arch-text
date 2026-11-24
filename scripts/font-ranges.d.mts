export const FAMILIES: string[];
export function readRanges(): Record<string, { file: string; ranges: [number, number][] }[]>;
export function render(ranges: Record<string, { file: string; ranges: [number, number][] }[]>): string;

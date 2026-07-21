export type AnsiCode = {
  code: string;
  endCode: string;
};

export const tokenize = (input: string) =>
  Array.from(input || '').map((value) => ({
    type: 'char' as const,
    value,
    fullWidth: false,
  }));

export const reduceAnsiCodes = (codes: AnsiCode[]) => codes;
export const ansiCodesToString = (codes: AnsiCode[]) => codes.map((c) => c.code).join('');
export const undoAnsiCodes = (_codes: AnsiCode[]) => [] as AnsiCode[];

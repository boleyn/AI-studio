export type AnsiCode = {
  type?: 'ansi'
  code: string
  endCode: string
}

export type AnsiToken =
  | {
      type: 'ansi'
      code: string
      endCode: string
    }
  | {
      type: 'char'
      value: string
      fullWidth: boolean
      styles: AnsiCode[]
    }

export type StyledChar = {
  value: string
  styles: AnsiCode[]
}

export declare function tokenize(input?: string): AnsiToken[]
export declare function reduceAnsiCodes(codes?: AnsiCode[]): AnsiCode[]
export declare function ansiCodesToString(codes?: AnsiCode[]): string
export declare function undoAnsiCodes(codes?: AnsiCode[]): AnsiCode[]
export declare function diffAnsiCodes(from?: AnsiCode[], to?: AnsiCode[]): AnsiCode[]
export declare function styledCharsFromTokens(tokens: AnsiToken[]): StyledChar[]

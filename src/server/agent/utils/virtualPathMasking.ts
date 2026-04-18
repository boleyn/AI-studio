/**
 * Masks absolute POSIX-like paths in free-form text.
 *
 * This is designed for user-visible error/output strings where runtime errors
 * may include host absolute paths. It handles both quoted and bare tokens.
 */
export function maskAbsolutePathsInText(
  input: string,
  maskPath: (absolutePath: string) => string,
): string {
  // First pass: quoted paths, e.g. "/Users/a/x" or '/tmp/x'
  let out = input.replace(
    /(["'])(\/[^"'\n]+)\1/g,
    (_match, quote: string, rawPath: string) =>
      `${quote}${maskPath(rawPath)}${quote}`,
  )

  // Second pass: bare absolute paths, e.g. Path /Users/a/x does not exist.
  // Capture an optional trailing punctuation so we don't feed it into masking.
  out = out.replace(
    /(^|[\s([<{])((?:\/[^\s)\]}>,"']+)+)([.,;!?]?)/g,
    (_match, prefix: string, rawPath: string, trail: string) =>
      `${prefix}${maskPath(rawPath)}${trail || ''}`,
  )

  return out
}


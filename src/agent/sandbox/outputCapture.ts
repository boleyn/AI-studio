import { mkdirSync, openSync, writeSync, closeSync, unlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Stream observations to disk while retaining a bounded in-memory preview.
 * A hard disk quota terminates the producer explicitly rather than silently
 * dropping output or letting untrusted commands exhaust memory/storage. */
export function createOutputCapture(root: string, onLimit: () => void) {
  const directory = path.join(root, ".aistudio", "context");
  mkdirSync(directory, { recursive: true });
  const realRoot = realpathSync(root);
  if (!realpathSync(directory).startsWith(realRoot + path.sep)) throw new Error("output_archive_outside_workspace");
  const id = randomUUID();
  let limited = false;
  let closed = false;
  const streams = ["stdout", "stderr"].map(name => {
    const filename = `exec-${id}.${name}.txt`;
    return { path: path.join(directory, filename), virtual: `/.aistudio/context/${filename}`, fd: openSync(path.join(directory, filename), "wx", 0o600), bytes: 0, preview: Buffer.alloc(0) };
  });
  const write = (index: number, chunk: Buffer) => {
    if (closed || limited) return;
    const stream = streams[index];
    const available = Math.max(0, 16 * 1024 * 1024 - stream.bytes);
    const bytes = chunk.subarray(0, available);
    try {
      writeSync(stream.fd, bytes);
      stream.bytes += bytes.length;
      if (stream.preview.length < 6000) stream.preview = Buffer.concat([stream.preview, bytes.subarray(0, 6000 - stream.preview.length)]);
      if (bytes.length < chunk.length) { limited = true; onLimit(); }
    } catch { limited = true; onLimit(); }
  };
  return {
    stdout: (chunk: Buffer) => write(0, chunk),
    stderr: (chunk: Buffer) => write(1, chunk),
    finish() {
      if (!closed) { closed = true; for (const stream of streams) closeSync(stream.fd); }
      const values = streams.map(stream => {
        if (stream.bytes <= 6000 && !limited) { try { unlinkSync(stream.path); } catch {} return stream.preview.toString("utf8"); }
        return `${stream.preview.toString("utf8")}\n[${limited ? "Output capture limit/error; command stopped, partial output" : "Full output"}: ${stream.virtual}; ${stream.bytes} bytes. Read this file rather than rerunning the command.]`;
      });
      return { stdout: values[0], stderr: values[1], limited };
    },
  };
}

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { SubtitleCue } from "@/lib/types";
import { safeFetch, screenUrl } from "@/lib/safe-fetch";
import { sanitizeUpstreamHeaders } from "@/lib/anime";

/**
 * Local speech-to-text for subtitle generation.
 *
 * Why this exists: a dub is not a read-aloud of the sub. Dub scripts are
 * rewritten to fit mouth flaps, so a sub's subtitle track genuinely does not
 * match dub audio — the very first line of Jujutsu Kaisen E1 is "Morning." in
 * the sub track and "Good morning." in the dub. No amount of re-timing fixes
 * that; the only correct fix is to transcribe whichever audio is playing.
 *
 * Why whisper.cpp: this had to be free and fast on both Apple Silicon and
 * Windows/NVIDIA. whisper.cpp is the only mainstream Whisper runtime with both
 * a Metal and a CUDA backend — faster-whisper is excellent on NVIDIA but
 * CPU-only on macOS. Nothing here calls a hosted API: no key, no per-episode
 * cost. Measured ~15x realtime on an M5 Pro with large-v3-turbo-q5_0.
 *
 * Progressive by design: audio is processed in ~60s chunks and cues are yielded
 * as each chunk finishes, so subtitles start appearing a second or two into the
 * request rather than after the whole episode.
 */

/** Seconds of audio per transcription chunk. */
const CHUNK_SECONDS = 60;
/**
 * The first chunk is shorter so the first cue lands sooner: measured on a
 * real HLS episode, segment fetch (sequential, one request per ~6-10s
 * segment) plus ffmpeg conversion dominate a chunk's wall time far more than
 * whisper itself does, so a smaller first chunk means fewer segments to fetch
 * before the viewer sees anything.
 */
const FIRST_CHUNK_SECONDS = 15;
const WHISPER_SAMPLE_RATE = 16_000;
const TS_PACKET_SIZE = 188;
const FETCH_TIMEOUT_MS = 30_000;

export interface AsrSource {
  /** Resolved upstream media URL (HLS playlist or progressive file). */
  url: string;
  /** Headers the media host requires (Referer, etc.). */
  headers?: Record<string, string>;
  isHLS: boolean;
}

export interface AsrOptions extends AsrSource {
  /** Spoken language of the audio: "en" for a dub, "ja" for the original. */
  language: string;
  /**
   * Translate to English instead of transcribing verbatim. Whisper does
   * X->English natively, which is what a Japanese track needs for English subs.
   */
  translate?: boolean;
  signal?: AbortSignal;
}

export class AsrUnavailableError extends Error {}

/**
 * whisper.cpp binary. Homebrew installs `whisper-cli`; the upstream Windows
 * CUDA release ships `whisper-cli.exe`. WHISPER_BIN overrides both.
 */
export function resolveWhisperBinary(): string {
  return (
    process.env.WHISPER_BIN?.trim() ||
    (process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli")
  );
}

/**
 * GGML model path. Defaults to large-v3-turbo quantized: the accuracy/speed
 * sweet spot, and multilingual, which the Japanese track needs.
 */
export function resolveWhisperModel(): string {
  if (process.env.WHISPER_MODEL?.trim()) return process.env.WHISPER_MODEL.trim();
  const candidates = [
    join(homedir(), ".cache", "whisper", "ggml-large-v3-turbo-q5_0.bin"),
    join(homedir(), ".cache", "whisper", "ggml-large-v3-turbo.bin"),
    join(homedir(), ".cache", "whisper", "ggml-base.bin"),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

export function asrReady(): { ready: boolean; reason?: string } {
  const model = resolveWhisperModel();
  if (!existsSync(model)) {
    return {
      ready: false,
      reason: `Whisper model not found at ${model} — see README, "Subtitle generation".`,
    };
  }
  return { ready: true };
}

/* -------------------------------------------------------------- media fetch */

async function fetchBuffer(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<Buffer> {
  // Provider media URLs are scraped, so this fetch needs the same egress guard
  // as the browser-facing proxy — see `safe-fetch.ts`.
  const { response } = await safeFetch(url, {
    headers,
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Media fetch failed (${response.status}) for ${url.slice(0, 80)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Strip any junk in front of the MPEG-TS payload.
 *
 * Some CDNs disguise segments as images to defeat hotlinking — the ones we see
 * are a 1x1 PNG followed by the real transport stream at byte 252. hls.js
 * tolerates this because it resyncs on the TS sync byte, but ffmpeg probes the
 * magic bytes, decides the segment is a PNG, and finds no audio. So we resync
 * ourselves: find the first 0x47 that repeats at 188-byte intervals.
 */
export function stripToTransportStream(data: Buffer): Buffer {
  if (data[0] === 0x47) return data;
  const limit = Math.min(data.length, 8192);
  for (let offset = 0; offset < limit; offset += 1) {
    if (data[offset] !== 0x47) continue;
    let aligned = true;
    for (let packet = 1; packet < 6; packet += 1) {
      const probe = offset + packet * TS_PACKET_SIZE;
      if (probe < data.length && data[probe] !== 0x47) {
        aligned = false;
        break;
      }
    }
    if (aligned) return data.subarray(offset);
  }
  return data;
}

interface Segment {
  url: string;
  duration: number;
}

function resolveRelative(base: string, target: string): string {
  return target.startsWith("http")
    ? target
    : `${base.replace(/\/[^/]*$/, "")}/${target}`;
}

/**
 * Resolve an HLS master to its media playlist and list the segments with their
 * durations (EXTINF), which give exact chunk offsets.
 */
async function readHlsSegments(
  source: AsrSource,
  signal?: AbortSignal
): Promise<Segment[]> {
  const headers = source.headers ?? {};
  let url = source.url;
  let text = (await fetchBuffer(url, headers, signal)).toString();

  if (/#EXT-X-STREAM-INF/.test(text)) {
    // Master playlist: take the first non-comment line. (Deliberately not the
    // I-frame variant, which is video-only and has no audio at all.)
    const variant = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (!variant) throw new Error("HLS master playlist has no variant");
    url = resolveRelative(url, variant);
    text = (await fetchBuffer(url, headers, signal)).toString();
  }

  const segments: Segment[] = [];
  let duration = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      duration = Number.parseFloat(line.slice(8)) || 0;
    } else if (line && !line.startsWith("#")) {
      segments.push({ url: resolveRelative(url, line), duration });
      duration = 0;
    }
  }
  if (segments.length === 0) throw new Error("HLS playlist contains no segments");
  return segments;
}

/**
 * Group segments into runs of roughly CHUNK_SECONDS, keeping start offsets.
 * The first run targets FIRST_CHUNK_SECONDS instead, for a faster first cue.
 */
function groupIntoChunks(segments: Segment[]): Array<{
  segments: Segment[];
  offset: number;
}> {
  const chunks: Array<{ segments: Segment[]; offset: number }> = [];
  let current: Segment[] = [];
  let currentDuration = 0;
  let offset = 0;

  for (const segment of segments) {
    current.push(segment);
    currentDuration += segment.duration;
    const target = chunks.length === 0 ? FIRST_CHUNK_SECONDS : CHUNK_SECONDS;
    if (currentDuration >= target) {
      chunks.push({ segments: current, offset });
      offset += currentDuration;
      current = [];
      currentDuration = 0;
    }
  }
  if (current.length > 0) chunks.push({ segments: current, offset });
  return chunks;
}

/* ------------------------------------------------------------------ ffmpeg  */

function run(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (line: string) => void } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (!options.onStdout) return;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) options.onStdout(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on("error", (error) =>
      reject(
        error.name === "AbortError"
          ? error
          : new AsrUnavailableError(
              `${command} could not be started (${error.message}). Is it installed?`
            )
      )
    );
    child.on("close", (code) => {
      if (options.onStdout && buffer) options.onStdout(buffer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/** Decode a buffer of MPEG-TS (or a URL range) into 16 kHz mono WAV. */
async function toWav(
  input:
    | { file: string }
    | { url: string; headers: Record<string, string>; start: number; duration: number },
  output: string,
  signal?: AbortSignal
): Promise<void> {
  const args = ["-hide_banner", "-loglevel", "error"];

  if ("file" in input) {
    args.push("-f", "mpegts", "-i", input.file);
  } else {
    // ffmpeg speaks far more than HTTP — `file:`, `concat:`, `subfile:` — so a
    // scraped source URL must be screened before it reaches `-i`, exactly as
    // the browser-facing path screens it before minting a proxy token.
    const reason = screenUrl(input.url);
    if (reason) throw new Error(`Refusing to transcode upstream URL (${reason})`);
    // ffmpeg splits `-headers` on CRLF, so a CR or LF in a scraped header value
    // injects additional request headers. `sanitizeUpstreamHeaders` drops those,
    // and this restricts ffmpeg to the protocols we intend.
    args.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto");
    for (const [name, value] of Object.entries(sanitizeUpstreamHeaders(input.headers))) {
      args.push("-headers", `${name}: ${value}\r\n`);
    }
    // Only valid on the HLS demuxer, and only needed there: ffmpeg 8 otherwise
    // rejects the extensionless segment URLs these providers hand out.
    if (input.url.includes(".m3u8")) args.push("-extension_picky", "0");
    args.push("-ss", String(input.start), "-t", String(input.duration), "-i", input.url);
  }

  args.push(
    "-vn",
    "-ac", "1",
    "-ar", String(WHISPER_SAMPLE_RATE),
    "-c:a", "pcm_s16le",
    "-y",
    output
  );
  await run("ffmpeg", args, { signal });
}

/* ----------------------------------------------------------------- whisper  */

/**
 * whisper.cpp prints one line per decoded segment:
 *   [00:00:00.000 --> 00:00:03.000]   Good morning.
 * Parsing stdout instead of reading an output file is what makes this stream.
 */
const SEGMENT_LINE =
  /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;

export function parseSegmentLine(
  line: string,
  offsetSeconds: number
): SubtitleCue | null {
  const match = line.match(SEGMENT_LINE);
  if (!match) return null;

  const toSeconds = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

  const text = match[9].trim();
  // Whisper brackets non-speech events like [Music] / [BLANK_AUDIO].
  if (!text || (text.startsWith("[") && text.endsWith("]")) || text === "(no speech)") {
    return null;
  }

  return {
    start: toSeconds(match[1], match[2], match[3], match[4]) + offsetSeconds,
    end: toSeconds(match[5], match[6], match[7], match[8]) + offsetSeconds,
    text,
  };
}

async function transcribeWav(
  file: string,
  offsetSeconds: number,
  options: AsrOptions,
  onCue: (cue: SubtitleCue) => void
): Promise<void> {
  const args = [
    "-m", resolveWhisperModel(),
    "-f", file,
    "-l", options.language,
    "-t", String(Math.max(2, Math.min(8, cpus().length - 1))),
    // Without -np the model/system banner interleaves with the segment lines.
    "-np",
  ];
  if (options.translate) args.push("-tr");

  await run(resolveWhisperBinary(), args, {
    signal: options.signal,
    onStdout: (line) => {
      const cue = parseSegmentLine(line, offsetSeconds);
      if (cue) onCue(cue);
    },
  });
}

/* -------------------------------------------------------------------- main  */

/**
 * Transcribe the source audio, yielding cues as each chunk completes.
 *
 * HLS is fetched segment-by-segment here rather than handed to ffmpeg, because
 * the providers we resolve serve obfuscated segments ffmpeg refuses to demux
 * (see `stripToTransportStream`). Progressive files go straight to ffmpeg with
 * a seek per chunk.
 */
export async function* transcribe(
  options: AsrOptions
): AsyncGenerator<SubtitleCue> {
  const ready = asrReady();
  if (!ready.ready) throw new AsrUnavailableError(ready.reason ?? "ASR unavailable");

  const headers = options.headers ?? {};
  const directory = await mkdtemp(join(tmpdir(), "pezzy-asr-"));

  try {
    if (options.isHLS) {
      const segments = await readHlsSegments(options, options.signal);
      const chunks = groupIntoChunks(segments);

      for (const [index, chunk] of chunks.entries()) {
        if (options.signal?.aborted) return;

        const parts: Buffer[] = [];
        for (const segment of chunk.segments) {
          parts.push(
            stripToTransportStream(
              await fetchBuffer(segment.url, headers, options.signal)
            )
          );
        }

        const ts = join(directory, `chunk-${index}.ts`);
        const wav = join(directory, `chunk-${index}.wav`);
        await writeFile(ts, Buffer.concat(parts));
        await toWav({ file: ts }, wav, options.signal);

        const cues: SubtitleCue[] = [];
        await transcribeWav(wav, chunk.offset, options, (cue) => cues.push(cue));
        for (const cue of cues) yield cue;

        await rm(ts, { force: true });
        await rm(wav, { force: true });
      }
      return;
    }

    // Progressive source: seek per chunk until ffmpeg produces no more audio.
    let offset = 0;
    for (let index = 0; index < 120; index += 1) {
      if (options.signal?.aborted) return;
      const duration = index === 0 ? FIRST_CHUNK_SECONDS : CHUNK_SECONDS;
      const wav = join(directory, `chunk-${index}.wav`);
      await toWav({ url: options.url, headers, start: offset, duration }, wav, options.signal);
      if (!existsSync(wav)) return;

      const cues: SubtitleCue[] = [];
      await transcribeWav(wav, offset, options, (cue) => cues.push(cue));
      await rm(wav, { force: true });
      // An empty chunk means we ran past the end of the file.
      if (cues.length === 0 && index > 0) return;
      for (const cue of cues) yield cue;
      offset += duration;
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** Serialize cues to a WebVTT document. */
export function cuesToVtt(cues: SubtitleCue[]): string {
  const stamp = (value: number) => {
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = Math.floor(value % 60);
    const ms = Math.round((value - Math.floor(value)) * 1000);
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":") +
      `.${String(ms).padStart(3, "0")}`;
  };

  return [
    "WEBVTT",
    "",
    ...cues.map((cue) => `${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`),
  ].join("\n");
}

/** Read the simple WebVTT shape written by `cuesToVtt`. */
export function vttToCues(vtt: string): SubtitleCue[] {
  const seconds = (stamp: string) => {
    const [h, m, s] = stamp.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number.parseFloat(s);
  };

  const cues: SubtitleCue[] = [];
  for (const block of vtt.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [from, to] = lines[timingIndex].split("-->").map((part) => part.trim());
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (text) cues.push({ start: seconds(from), end: seconds(to), text });
  }
  return cues;
}

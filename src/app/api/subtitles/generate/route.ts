import type { ContentLanguage } from "@/lib/stream-resolver";
import { NextResponse } from "next/server";
import { resolveAnimeSources } from "@/lib/anime";
import {
  asrReady,
  cuesToVtt,
  transcribe,
  vttToCues,
  AsrUnavailableError,
} from "@/lib/asr";
import { getCatalogTitle } from "@/lib/catalog-service";
import { resolveSeasonEpisode } from "@/app/api/_lib/resolve-season-episode";
import { getGeneratedTrack, putGeneratedTrack } from "@/lib/subtitle-store";
import {
  translateCues,
  TranslationUnavailableError,
} from "@/lib/subtitle-translation";
import { getActiveProfile } from "@/lib/active-profile";
import { getPreferredSubtitleLanguages } from "@/lib/db";
import { orderSubtitleLanguages } from "@/lib/subtitle-languages";
import { checkRateLimit } from "@/lib/rate-limit";
import type { SubtitleCue } from "@/lib/types";

export const runtime = "nodejs";
// Transcribing a full episode takes a couple of minutes at ~15x realtime.
export const maxDuration = 600;

const activeJobs = new Set<string>();

/**
 * Generate subtitles from the episode's own audio, streamed as they're decoded.
 *
 * This is the fix for subtitles that don't match a dub: the provider's subtitle
 * track is a translation of the *Japanese* script, while a dub is rewritten to
 * fit mouth flaps. We transcribe whichever audio track the viewer selected, so
 * `audio=dub` produces English cues that match the English dialogue, and
 * `audio=sub` produces cues from the Japanese audio (translated when asked).
 *
 * Cost note (PRD R3): transcription runs locally via whisper.cpp — no provider,
 * no key, no per-episode charge — but it is still expensive in wall-clock time,
 * so a finished track is persisted and served instantly forever after.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    titleId?: unknown;
    season?: unknown;
    episode?: unknown;
    audio?: unknown;
  };

  if (typeof body.titleId !== "string") {
    return NextResponse.json({ error: "titleId is required" }, { status: 400 });
  }
  const audio = body.audio === "dub" ? "dub" : "sub";

  const title = await getCatalogTitle(body.titleId);
  if (!title) {
    return NextResponse.json({ error: "Unknown titleId" }, { status: 404 });
  }

  const resolved = resolveSeasonEpisode(title, body.season, body.episode);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "A valid season and episode are required" },
      { status: 400 }
    );
  }
  const { season, episode } = resolved;

  const mediaId = season?.mediaId ?? title.id;
  const keyPrefix = `${mediaId}:${episode}:${audio}`;
  const sourceLanguage = audio === "dub" ? "en" : "ja";
  const sourceKey = `${keyPrefix}:${sourceLanguage}`;
  const trackKey = (language: string) => `${keyPrefix}:${language}`;
  const profile = await getActiveProfile();
  const languages = orderSubtitleLanguages(
    profile ? getPreferredSubtitleLanguages(profile.id) : []
  );

  // A complete language set is served without running either model again.
  const cachedTracks = await Promise.all(
    languages.map(async (language) => ({
      ...language,
      vtt: await getGeneratedTrack(trackKey(language.code)),
    }))
  );
  if (cachedTracks.every((track) => track.vtt)) {
    return NextResponse.json({
      done: true,
      cached: true,
      tracks: cachedTracks,
    });
  }

  // languages always covers the full SUBTITLE_LANGUAGES set (just reordered),
  // so the source language's cached lookup is already in cachedTracks.
  const existingSource = cachedTracks.find((track) => track.code === sourceLanguage)?.vtt ?? null;
  const ready = existingSource ? { ready: true } : asrReady();
  if (!ready.ready) {
    return NextResponse.json({ error: ready.reason }, { status: 503 });
  }

  // Bounds cost when generation is triggered automatically (autostart on
  // playback) rather than by an explicit click — a profile can't run up
  // unbounded transcription/translation cost just by watching episodes.
  const { ok: withinRateLimit } = checkRateLimit(`subs-gen:${profile?.id ?? "anon"}`, {
    limit: 8,
    windowMs: 60 * 60 * 1000,
  });
  if (!withinRateLimit) {
    return NextResponse.json(
      { error: "Subtitle generation rate limit exceeded for this profile" },
      { status: 429 }
    );
  }

  // Transcription is heavy; one active job per episode+track at a time.
  if (activeJobs.has(keyPrefix)) {
    return NextResponse.json(
      { error: "A transcription for this episode is already running" },
      { status: 429 }
    );
  }
  activeJobs.add(keyPrefix);

  const encoder = new TextEncoder();
  const cues: SubtitleCue[] = [];
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream({
    async start(streamController) {
      const send = (event: string, data: unknown) =>
        streamController.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        send("start", { audio, languages });

        if (existingSource) {
          cues.push(...vttToCues(existingSource));
          send("phase", { phase: "translating" });
          send("track", {
            code: sourceLanguage,
            name: languages.find((item) => item.code === sourceLanguage)?.name,
            vtt: existingSource,
          });
        } else {
          // Sent before resolving the stream so the client can render a
          // "preparing" state instead of appearing to hang while the
          // provider handshake / playlist fetch happens.
          send("phase", { phase: "preparing" });
          let source;
          try {
            const sources = await resolveAnimeSources({
              title,
              season,
              episode,
              language: audio as ContentLanguage,
            });
            source = sources[0];
          } catch {
            source = undefined;
          }
          if (!source) {
            send("error", { message: `No ${audio} stream is available for this episode` });
            return;
          }

          send("phase", { phase: "transcribing" });
          for await (const cue of transcribe({
            url: source.url,
            headers: source.headers,
            isHLS: source.isHLS,
            language: sourceLanguage,
            signal: controller.signal,
          })) {
            cues.push(cue);
            send("cue", { language: sourceLanguage, cue });
            send("progress", {
              phase: "transcribing",
              count: cues.length,
              generatedThrough: cue.end,
            });
          }
          if (!controller.signal.aborted) {
            await putGeneratedTrack(sourceKey, cuesToVtt(cues));
          }
        }

        if (!controller.signal.aborted) {
          const missingTargets = cachedTracks.filter(
            (track) => track.code !== sourceLanguage && !track.vtt
          );
          for (const track of cachedTracks) {
            if (track.code !== sourceLanguage && track.vtt) send("track", track);
          }

          if (missingTargets.length > 0) {
            send("phase", { phase: "translating" });
            send("translation-progress", {
              total: missingTargets.length,
              done: 0,
              languages: missingTargets.map((target) => target.code),
            });
            let settled = 0;
            // Each language is streamed out as it settles rather than after
            // the whole batch, so one failing language doesn't hold up (or
            // hide) the ones that succeeded.
            await translateCues(
              cues,
              sourceLanguage,
              missingTargets,
              controller.signal,
              async (target, result) => {
                settled += 1;
                if ("error" in result) {
                  send("track-error", {
                    code: target.code,
                    name: target.name,
                    message: result.error,
                  });
                } else {
                  const vtt = cuesToVtt(result.cues);
                  await putGeneratedTrack(trackKey(target.code), vtt);
                  send("track", { ...target, vtt });
                }
                send("translation-progress", {
                  total: missingTargets.length,
                  done: settled,
                  languages: missingTargets.map((t) => t.code),
                });
              }
            );
          }
          send("done", { count: cues.length, languages: languages.length });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          send("error", {
            message:
              error instanceof AsrUnavailableError ||
              error instanceof TranslationUnavailableError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Transcription failed",
          });
        }
      } finally {
        activeJobs.delete(keyPrefix);
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}

"use client";

import * as React from "react";
import Hls from "hls.js";
import { useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Captions,
  CaptionsOff,
  Check,
  ChevronRight,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reportProgress, reportProgressOnUnload } from "@/lib/watch-progress";

interface Subtitle {
  url: string;
  label: string;
  language: string;
}

interface Stream {
  id: string;
  provider: string;
  label: string;
  url: string;
  isHLS: boolean;
  quality: "1080p" | "720p" | "480p" | "360p" | "auto";
  language: "sub" | "dub" | "raw";
  subtitles: Subtitle[];
}

interface Level {
  index: number;
  label: string;
}

const SEEK_STEP = 10;
const CONTROLS_IDLE_MS = 2800;
const QUALITY_ORDER: Stream["quality"][] = ["1080p", "720p", "480p", "360p", "auto"];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Prettify provider subtitle labels like "Spanish (- Espanol(Espana))". */
function cleanLabel(label: string): string {
  return label.replace(/\s*\(-\s*/g, " (").replace(/\s+/g, " ").trim();
}

/** Subtitle appearance is a session/client preference, not a DB setting (see summary). */
interface SubtitleAppearance {
  delay: number;
  size: "small" | "medium" | "large";
  textOpacity: number;
  backgroundOpacity: number;
  color: string;
  position: "top" | "middle" | "bottom";
}

const DEFAULT_APPEARANCE: SubtitleAppearance = {
  delay: 0,
  size: "medium",
  textOpacity: 1,
  backgroundOpacity: 0.6,
  color: "#ffffff",
  position: "bottom",
};

const APPEARANCE_STORAGE_KEY = "pezzy:subtitle-appearance";
const SUBTITLE_SIZE_PX: Record<SubtitleAppearance["size"], number> = {
  small: 18,
  medium: 24,
  large: 32,
};
const SUBTITLE_COLORS = ["#ffffff", "#ffe066", "#7cd4fd"];
const OPACITY_SLIDER_CLASS =
  "h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/30 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white";

function loadAppearance(): SubtitleAppearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

// Module-level store (mirrors src/lib/my-list.ts's pattern) so reading
// localStorage happens outside render/effect bodies — the SSR snapshot below
// always stays the default, so hydration can't mismatch it.
let appearanceCache: SubtitleAppearance | null = null;
const appearanceListeners = new Set<() => void>();

function getAppearanceSnapshot(): SubtitleAppearance {
  if (!appearanceCache) appearanceCache = loadAppearance();
  return appearanceCache;
}

function getServerAppearanceSnapshot(): SubtitleAppearance {
  return DEFAULT_APPEARANCE;
}

function subscribeAppearance(listener: () => void): () => void {
  appearanceListeners.add(listener);
  return () => appearanceListeners.delete(listener);
}

function setAppearance(next: SubtitleAppearance): void {
  appearanceCache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures (quota, privacy mode, etc.)
    }
  }
  for (const listener of appearanceListeners) listener();
}

function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.min(Math.max(alpha, 0), 1);
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/** Native `line` position for a cue, keyed to the appearance's vertical setting. */
function lineForPosition(
  position: SubtitleAppearance["position"]
): { line: number; snapToLines: boolean } {
  if (position === "top") return { line: 10, snapToLines: false };
  if (position === "middle") return { line: 50, snapToLines: false };
  // Bottom, lifted clear of the control bar — negative `line` counts rows up
  // from the bottom, which is exactly where our controls sit.
  return { line: -3, snapToLines: true };
}

/** Minimal WebVTT reader for a previously generated track served in one piece. */
function parseVtt(vtt: string): Array<{ start: number; end: number; text: string }> {
  const seconds = (stamp: string) => {
    const [h, m, s] = stamp.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number.parseFloat(s);
  };

  const cues: Array<{ start: number; end: number; text: string }> = [];
  for (const block of vtt.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const [from, to] = timing.split("-->").map((part) => part.trim());
    const text = lines.slice(lines.indexOf(timing) + 1).join("\n").trim();
    if (text) cues.push({ start: seconds(from), end: seconds(to), text });
  }
  return cues;
}

export function VideoPlayer({
  titleId,
  season,
  episode,
  malId,
  autoSkipIntro = false,
  preferredAudio = "ask",
  alwaysGenerateSubtitles = false,
  nextEpisodeHref,
  startPositionSeconds,
}: {
  titleId: string;
  season?: number;
  episode?: number;
  malId?: string;
  autoSkipIntro?: boolean;
  preferredAudio?: "ask" | "sub" | "dub";
  alwaysGenerateSubtitles?: boolean;
  nextEpisodeHref?: string;
  startPositionSeconds?: number;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const hlsRef = React.useRef<Hls | null>(null);
  const idleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekSettleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAppliedRef = React.useRef("");
  const reduceMotion = useReducedMotion();
  // Scopes the ::cue style block to this player instance (there can be more than one on a page).
  const cueStyleId = React.useId().replace(/:/g, "");

  // Identifies "this episode" for effects that must fire once per episode
  // (audio fallback, auto-skip, auto-generate subtitles, skip-times lookup).
  const episodeKey = React.useMemo(
    () => `${titleId}:${season}:${episode}`,
    [episode, season, titleId]
  );

  // Preselects the sub/dub the profile prefers; "ask" keeps today's default.
  // The user can still override per episode from the settings menu.
  const [language, setLanguage] = React.useState<"sub" | "dub">(
    preferredAudio === "dub" ? "dub" : "sub"
  );
  const audioFallbackTried = React.useRef("");
  const [audioFallbackNotice, setAudioFallbackNotice] = React.useState("");
  const [streams, setStreams] = React.useState<Stream[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [slowLoad, setSlowLoad] = React.useState(false);
  // Which provider actually produced `streams` (may differ from the forced
  // pick below when nothing is forced — the race-and-fallback default).
  const [activeProvider, setActiveProvider] = React.useState<string | null>(null);
  const [providerList, setProviderList] = React.useState<string[]>([]);

  // Which provider the profile forces, so a broken stream from one provider
  // doesn't have to be re-picked every episode. Null = fast race-and-fallback.
  const [preferredProvider, setPreferredProvider] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/settings/preferred-provider")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { preferredProvider?: string | null } | null) => {
        if (active && data) setPreferredProvider(data.preferredProvider ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const chooseProvider = React.useCallback((provider: string | null) => {
    setPreferredProvider(provider);
    fetch("/api/settings/preferred-provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredProvider: provider }),
    }).catch(() => {});
  }, []);

  const [playing, setPlaying] = React.useState(false);
  const [buffering, setBuffering] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [buffered, setBuffered] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [menu, setMenu] = React.useState<"none" | "captions" | "settings">("none");

  // Quality levels arrive asynchronously from hls.js, so they're state — but
  // keyed by stream so a stale list can't leak onto the next source.
  const [levelState, setLevelState] = React.useState<{
    key: string;
    levels: Level[];
  }>({ key: "", levels: [] });
  const [level, setLevel] = React.useState(-1);

  const selected = streams.find((stream) => stream.id === selectedId);
  const subtitles = React.useMemo(
    () => selected?.subtitles ?? [],
    [selected]
  );

  const levels = levelState.key === selectedId ? levelState.levels : [];

  // The resolved provider can return several real renditions of the same
  // stream (not fabricated) — only treat it as a quality picker when they
  // actually differ, so a single-rendition source doesn't get a fake list.
  const qualityVariants = React.useMemo(
    () =>
      streams.length > 1 && new Set(streams.map((stream) => stream.quality)).size > 1
        ? [...streams].sort(
            (a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality)
          )
        : null,
    [streams]
  );

  /**
   * Which subtitle track is showing. Derived rather than stored: a subbed
   * stream defaults to English (that's the point of subs), and the user's
   * choice is an override scoped to the current stream + audio track, so
   * switching episode or sub/dub falls back to the default again.
   */
  const trackKey = `${selectedId}:${language}`;
  const [trackOverride, setTrackOverride] = React.useState<{
    key: string;
    value: number;
  } | null>(null);

  const defaultTextTrack = React.useMemo(() => {
    if (subtitles.length === 0 || language !== "sub") return -1;
    const english = subtitles.findIndex((track) => /^english/i.test(track.label));
    return english >= 0 ? english : 0;
  }, [language, subtitles]);

  const textTrack =
    trackOverride?.key === trackKey ? trackOverride.value : defaultTextTrack;

  const setTextTrack = React.useCallback(
    (value: number) => setTrackOverride({ key: trackKey, value }),
    [trackKey]
  );

  /**
   * Subtitles transcribed from this stream's own audio.
   *
   * Needed because a provider's subtitle track is a translation of the Japanese
   * script — it does not match a dub, whose dialogue is rewritten to fit mouth
   * flaps. Generating from the audio the viewer is actually hearing is the only
   * thing that lines up.
   */
  const generatedTrackRefs = React.useRef(new Map<string, TextTrack>());
  const notifiedLanguageSets = React.useRef(new Set<string>());
  const [generatedTracks, setGeneratedTracks] = React.useState<
    Array<{ key: string; code: string; name: string; index: number }>
  >([]);
  const [subtitleToast, setSubtitleToast] = React.useState<{
    key: string;
    message: string;
  } | null>(null);
  const [asr, setAsr] = React.useState<{
    status: "idle" | "running" | "done" | "error";
    count: number;
    phase?: "preparing" | "transcribing" | "translating";
    generatedThrough?: number;
    translationDone?: number;
    translationTotal?: number;
    trackErrors?: Array<{ code: string; name: string; message: string }>;
    message?: string;
    key?: string;
  }>({ status: "idle", count: 0 });

  // Subtitle appearance (delay, size, colour, opacity, position) is a
  // client-side preference, not the DB's unwired `subtitle_size` column —
  // see the summary for why. useSyncExternalStore keeps the SSR pass on the
  // default (no localStorage access there) so hydration can't mismatch it.
  // Kept in a ref too so cue math never needs to be in the dependency list
  // of the callbacks that create cues.
  const appearance = React.useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getServerAppearanceSnapshot
  );
  const appearanceRef = React.useRef(appearance);
  appearanceRef.current = appearance;

  const updateAppearance = React.useCallback((patch: Partial<SubtitleAppearance>) => {
    setAppearance({ ...getAppearanceSnapshot(), ...patch });
  }, []);

  // Original (untouched) cue times, so the delay control can always compute
  // from a fixed baseline instead of drifting on repeated adjustments.
  const cueOriginalTimes = React.useRef(new WeakMap<VTTCue, { start: number; end: number }>());

  const applyCueStyle = React.useCallback((cue: VTTCue): VTTCue => {
    let original = cueOriginalTimes.current.get(cue);
    if (!original) {
      original = { start: cue.startTime, end: cue.endTime };
      cueOriginalTimes.current.set(cue, original);
    }
    const { line, snapToLines } = lineForPosition(appearanceRef.current.position);
    cue.snapToLines = snapToLines;
    cue.line = line;
    cue.startTime = Math.max(original.start + appearanceRef.current.delay, 0);
    cue.endTime = Math.max(original.end + appearanceRef.current.delay, 0);
    return cue;
  }, []);

  // Delay/position changes must reach cues that already exist, not just ones
  // created from here on — this walks every track (provider + generated).
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      for (const cue of Array.from(track.cues ?? [])) applyCueStyle(cue as VTTCue);
    }
  }, [appearance.delay, appearance.position, applyCueStyle]);

  const activeGeneratedTracks = generatedTracks.filter(
    (track) => track.key === trackKey
  );
  const activeGeneratedLanguageSet = activeGeneratedTracks
    .map((track) => track.code)
    .sort()
    .join(",");
  const generatedAvailable =
    asr.key === trackKey && activeGeneratedTracks.length > 0;

  React.useEffect(() => {
    if (
      asr.status !== "done" ||
      asr.key !== trackKey ||
      activeGeneratedTracks.length < 2
    ) {
      return;
    }

    const notificationKey = `${trackKey}:${activeGeneratedLanguageSet}`;
    if (notifiedLanguageSets.current.has(notificationKey)) return;

    notifiedLanguageSets.current.add(notificationKey);
    setSubtitleToast({
      key: notificationKey,
      message: `${activeGeneratedTracks.length} subtitle languages are now available`,
    });
  }, [
    activeGeneratedLanguageSet,
    activeGeneratedTracks.length,
    asr.key,
    asr.status,
    trackKey,
  ]);

  React.useEffect(() => {
    if (!subtitleToast) return;
    const notificationKey = subtitleToast.key;
    const timer = window.setTimeout(() => {
      setSubtitleToast((current) =>
        current?.key === notificationKey ? null : current
      );
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [subtitleToast]);

  const addGeneratedTrack = React.useCallback(
    (code: string, name: string, vtt?: string) => {
      const video = videoRef.current;
      if (!video) return -1;

      const generatedKey = `${trackKey}:${code}`;
      let track = generatedTrackRefs.current.get(generatedKey);
      if (!track) {
        track = video.addTextTrack("subtitles", `${name} (from ${language} audio)`, code);
        generatedTrackRefs.current.set(generatedKey, track);
      }
      if (vtt && track.cues?.length === 0) {
        for (const cue of parseVtt(vtt)) {
          track.addCue(applyCueStyle(new VTTCue(cue.start, cue.end, cue.text)));
        }
      }

      const index = Array.from(video.textTracks).indexOf(track);
      setGeneratedTracks((current) =>
        current.some((item) => item.key === trackKey && item.code === code)
          ? current
          : [...current, { key: trackKey, code, name, index }]
      );
      return index;
    },
    [applyCueStyle, language, trackKey]
  );

  const generateSubtitles = React.useCallback(async () => {
    const video = videoRef.current;
    if (!video || asr.status === "running") return;

    setAsr({ status: "running", count: 0, phase: "preparing", key: trackKey });
    setMenu("none");

    const sourceCode = language === "dub" ? "en" : "ja";
    const sourceName = language === "dub" ? "English" : "Japanese";
    const sourceIndex = addGeneratedTrack(sourceCode, sourceName);
    // Select it, or the mode-syncing effect below immediately disables it
    // again — `textTrack` is the single source of truth for what's showing.
    setTextTrack(sourceIndex);

    try {
      const response = await fetch("/api/subtitles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titleId, season, episode, audio: language }),
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(detail?.error ?? "Could not generate subtitles");
      }

      // A previously generated track comes back as a whole document, not a
      // stream, so there is nothing to parse incrementally.
      if (response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as {
          tracks?: Array<{ code: string; name: string; vtt: string }>;
        };
        for (const track of payload.tracks ?? []) {
          addGeneratedTrack(track.code, track.name, track.vtt);
        }
        const count = parseVtt(payload.tracks?.[0]?.vtt ?? "").length;
        setAsr({ status: "done", count, key: trackKey });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let count = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);

          if (event === "cue") {
            const track = generatedTrackRefs.current.get(
              `${trackKey}:${payload.language}`
            );
            const cue = payload.cue;
            track?.addCue(applyCueStyle(new VTTCue(cue.start, cue.end, cue.text)));
            count += 1;
            setAsr((current) => ({
              ...current,
              status: "running",
              count,
              key: trackKey,
            }));
          } else if (event === "phase") {
            setAsr((current) => ({
              ...current,
              status: "running",
              phase: payload.phase,
              key: trackKey,
            }));
          } else if (event === "progress") {
            setAsr((current) => ({
              ...current,
              status: "running",
              phase: payload.phase,
              count: payload.count,
              generatedThrough: payload.generatedThrough,
              key: trackKey,
            }));
          } else if (event === "translation-progress") {
            setAsr((current) => ({
              ...current,
              status: "running",
              phase: "translating",
              translationDone: payload.done,
              translationTotal: payload.total,
              key: trackKey,
            }));
          } else if (event === "track") {
            addGeneratedTrack(payload.code, payload.name, payload.vtt);
          } else if (event === "track-error") {
            setAsr((current) => ({
              ...current,
              status: "running",
              key: trackKey,
              trackErrors: [
                ...(current.trackErrors ?? []),
                { code: payload.code, name: payload.name, message: payload.message },
              ],
            }));
          } else if (event === "done") {
            setAsr((current) => ({
              status: "done",
              count,
              key: trackKey,
              trackErrors: current.trackErrors,
            }));
          } else if (event === "error") {
            throw new Error(payload.message ?? "Transcription failed");
          }
        }
      }
      setAsr((current) =>
        current.status === "running"
          ? { status: "done", count, key: trackKey, trackErrors: current.trackErrors }
          : current
      );
    } catch (caught) {
      setAsr({
        status: "error",
        count: 0,
        key: trackKey,
        message: caught instanceof Error ? caught.message : "Transcription failed",
      });
    }
  }, [
    addGeneratedTrack,
    applyCueStyle,
    asr.status,
    episode,
    language,
    season,
    setTextTrack,
    titleId,
    trackKey,
  ]);

  /* ---------------------------------------------------------------- streams */

  React.useEffect(() => {
    let active = true;
    // A cold resolve can legitimately take past a minute (fuzzy title-search
    // fallback providers), so this is reassurance, not a client-side timeout.
    const slowTimer = window.setTimeout(() => {
      if (active) setSlowLoad(true);
    }, 8000);

    // No stream at all for the preferred audio: fall back to the other
    // track once per episode instead of leaving the player empty. Returns
    // whether a fallback was applied.
    function tryAudioFallback(): boolean {
      if (
        preferredAudio === "ask" ||
        language !== preferredAudio ||
        audioFallbackTried.current === episodeKey
      ) {
        return false;
      }
      audioFallbackTried.current = episodeKey;
      const fallback = preferredAudio === "dub" ? "sub" : "dub";
      setAudioFallbackNotice(
        `No ${preferredAudio} audio available for this episode — switched to ${fallback}.`
      );
      setLanguage(fallback);
      return true;
    }

    async function load() {
      setLoading(true);
      setSlowLoad(false);
      setError("");
      try {
        const response = await fetch("/api/anime/streams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titleId,
            season,
            episode,
            language,
            provider: preferredProvider ?? undefined,
          }),
        });
        const result = (await response.json()) as {
          streams?: Stream[];
          provider?: string | null;
          providers?: string[];
          error?: string;
        };
        if (!active) return;
        setProviderList(result.providers ?? []);

        if (!response.ok) {
          throw new Error(result.error ?? "Could not find anime streams");
        }
        const nextStreams = result.streams ?? [];

        if (nextStreams.length === 0 && tryAudioFallback()) return;

        setStreams(nextStreams);
        setActiveProvider(result.provider ?? null);
        setSelectedId(nextStreams[0]?.id ?? "");
      } catch (caught) {
        if (!active) return;

        if (tryAudioFallback()) return;

        setStreams([]);
        setActiveProvider(null);
        setSelectedId("");
        setError(
          caught instanceof Error ? caught.message : "Could not find anime streams"
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(slowTimer);
    };
  }, [episode, episodeKey, language, preferredAudio, preferredProvider, season, titleId]);

  React.useEffect(() => {
    if (!audioFallbackNotice) return;
    const timer = window.setTimeout(() => setAudioFallbackNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [audioFallbackNotice]);

  // Fires generation once per episode when the profile has it enabled — not
  // on every render, seek, or manual track switch. Never blocks playback.
  const autoGeneratedEpisodes = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!alwaysGenerateSubtitles || !selected) return;
    if (autoGeneratedEpisodes.current.has(episodeKey)) return;
    autoGeneratedEpisodes.current.add(episodeKey);
    void generateSubtitles();
  }, [alwaysGenerateSubtitles, episodeKey, generateSubtitles, selected]);

  /* ---------------------------------------------------------------- source  */

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;

    if (selected.isHLS && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(selected.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevel(-1);
        setLevelState({
          key: selected.id,
          levels: hls.levels.map((entry, index) => ({
            index,
            label: entry.height
              ? `${entry.height}p`
              : `${Math.round(entry.bitrate / 1000)}k`,
          })),
        });
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // Safari plays HLS natively; everything else here is a plain MP4.
    video.src = selected.url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [selected]);

  /* --------------------------------------------------------------- captions */

  // React's `default` attribute on <track> is unreliable across reloads, so the
  // showing/disabled mode is driven imperatively from `textTrack`.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i += 1) {
      tracks[i].mode = i === textTrack ? "showing" : "disabled";
    }

    // Provider tracks parse their cues asynchronously, so they can't be
    // styled at creation time the way generated cues are — do it once they
    // arrive, and again on every cuechange (a no-op once delay/position match).
    const active = tracks[textTrack];
    if (!active) return;
    const lift = () => {
      for (const cue of Array.from(active.cues ?? [])) applyCueStyle(cue as VTTCue);
    };
    lift();
    active.addEventListener("cuechange", lift);
    return () => active.removeEventListener("cuechange", lift);
  }, [applyCueStyle, textTrack, selected, subtitles.length, activeGeneratedTracks.length, asr.status]);

  /* ------------------------------------------------------------- skip times */

  const [skipTimes, setSkipTimes] = React.useState<{
    key: string;
    op?: { start: number; end: number };
    ed?: { start: number; end: number };
  } | null>(null);
  const [autoSkipToast, setAutoSkipToast] = React.useState("");
  const autoSkippedRef = React.useRef("");

  // Looked up once metadata gives a real duration — AniSkip tolerates 0 but
  // is more accurate with it, and this avoids firing twice for one episode.
  React.useEffect(() => {
    if (!malId || episode === undefined || duration <= 0) return;
    if (skipTimes?.key === episodeKey) return;

    let active = true;
    fetch(
      `/api/skip-times?malId=${encodeURIComponent(malId)}&episode=${episode}&episodeLength=${Math.round(duration)}`
    )
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { op?: { start: number; end: number }; ed?: { start: number; end: number } }) => {
        if (active) setSkipTimes({ key: episodeKey, op: data.op, ed: data.ed });
      })
      .catch(() => {
        if (active) setSkipTimes({ key: episodeKey });
      });
    return () => {
      active = false;
    };
  }, [duration, episode, episodeKey, malId, skipTimes?.key]);

  const activeSkip = skipTimes?.key === episodeKey ? skipTimes : null;
  const inOpening = Boolean(
    activeSkip?.op && current >= activeSkip.op.start && current < activeSkip.op.end
  );
  const inEnding = Boolean(
    activeSkip?.ed && current >= activeSkip.ed.start && current < activeSkip.ed.end
  );

  // Auto-skip fires once per episode's opening; the manual button (rendered
  // below) handles it otherwise.
  React.useEffect(() => {
    if (!autoSkipIntro || !inOpening || !activeSkip?.op) return;
    if (autoSkippedRef.current === episodeKey) return;
    autoSkippedRef.current = episodeKey;
    const video = videoRef.current;
    if (video) video.currentTime = activeSkip.op.end;
    setAutoSkipToast("Skipped intro");
  }, [activeSkip, autoSkipIntro, episodeKey, inOpening]);

  React.useEffect(() => {
    if (!autoSkipToast) return;
    const timer = window.setTimeout(() => setAutoSkipToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [autoSkipToast]);

  /* ------------------------------------------------------------ video state */

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;

    const progressUpdate = () => ({
      titleId,
      seasonNumber: season ?? 0,
      episodeNumber: episode ?? 1,
      audioLanguage: language,
      positionSeconds: video.currentTime,
      durationSeconds: video.duration || undefined,
    });

    const onTime = () => {
      setCurrent(video.currentTime);
      reportProgress(progressUpdate());
    };
    const onDuration = () => {
      setDuration(video.duration);
      // Resume once per episode, and never seek into the last couple of
      // percent — that's effectively "already finished".
      if (
        resumeAppliedRef.current !== episodeKey &&
        startPositionSeconds &&
        startPositionSeconds > 0 &&
        video.duration > 0 &&
        startPositionSeconds < video.duration * 0.98
      ) {
        resumeAppliedRef.current = episodeKey;
        video.currentTime = startPositionSeconds;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      reportProgress(progressUpdate(), true);
    };
    const onEnded = () => {
      reportProgress({ ...progressUpdate(), completed: true }, true);
    };
    const onSeeked = () => {
      if (seekSettleTimer.current) clearTimeout(seekSettleTimer.current);
      seekSettleTimer.current = setTimeout(() => reportProgress(progressUpdate(), true), 800);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("progress", onProgress);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("progress", onProgress);
      if (seekSettleTimer.current) clearTimeout(seekSettleTimer.current);
      // A reliable final write when the source changes or the player unmounts —
      // sendBeacon survives a page teardown that would drop a plain fetch.
      reportProgressOnUnload(progressUpdate());
    };
  }, [episode, episodeKey, language, season, selected, startPositionSeconds, titleId]);

  React.useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* ----------------------------------------------------------------- actions */

  const togglePlay = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seekBy = React.useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(
      Math.max(video.currentTime + delta, 0),
      video.duration || Number.MAX_SAFE_INTEGER
    );
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  const showControls = React.useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      // Never hide the bar while a menu is open or the video is paused.
      setControlsVisible((visible) =>
        videoRef.current?.paused ? visible : false
      );
    }, CONTROLS_IDLE_MS);
  }, []);

  // Opening a menu pins the control bar open (the idle timer would hide it).
  const openMenu = React.useCallback((next: "captions" | "settings") => {
    setControlsVisible(true);
    setMenu((value) => (value === next ? "none" : next));
  }, []);

  React.useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  /* -------------------------------------------------------------- shortcuts */

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Don't steal keys from the source/audio selects or any other input.
      if (
        target &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "arrowright":
          event.preventDefault();
          seekBy(SEEK_STEP);
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(-SEEK_STEP);
          break;
        case "arrowup":
          event.preventDefault();
          video.volume = Math.min(video.volume + 0.1, 1);
          break;
        case "arrowdown":
          event.preventDefault();
          video.volume = Math.max(video.volume - 0.1, 0);
          break;
        case "m":
          video.muted = !video.muted;
          break;
        case "f":
          toggleFullscreen();
          break;
        case "c":
          if (subtitles.length > 0) setTextTrack(textTrack === -1 ? 0 : -1);
          break;
        default:
          return;
      }
      showControls();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    seekBy,
    setTextTrack,
    showControls,
    subtitles.length,
    textTrack,
    toggleFullscreen,
    togglePlay,
  ]);

  /* ------------------------------------------------------------------ render */

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  const aheadBy =
    asr.phase === "transcribing" && asr.generatedThrough !== undefined
      ? asr.generatedThrough - current
      : undefined;

  return (
    <div className="bg-card">
      <style>{`
        #${cueStyleId} video::cue {
          font-size: ${SUBTITLE_SIZE_PX[appearance.size]}px;
          color: ${withAlpha(appearance.color, appearance.textOpacity)};
          background-color: ${withAlpha("#000000", appearance.backgroundOpacity)};
        }
      `}</style>
      <div
        id={cueStyleId}
        ref={containerRef}
        onMouseMove={showControls}
        onMouseLeave={() => menu === "none" && setControlsVisible(false)}
        className="group relative aspect-video w-full overflow-hidden bg-black"
      >
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
            {/* A cold resolve can legitimately take past a minute on some
                titles/providers — this is reassurance, not an error. */}
            {slowLoad && (
              <p className="max-w-xs px-4 text-xs text-muted-foreground">
                Still looking for a stream — this can take up to a minute for some episodes.
              </p>
            )}
          </div>
        ) : error || !selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {error || `No ${language} stream is available for this episode.`}
            </p>
            {providerList.length > 1 && (
              <div className="flex flex-wrap justify-center gap-2">
                {providerList.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => chooseProvider(id)}
                    className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10"
                  >
                    Try {id}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <video
              key={selected.id}
              ref={videoRef}
              autoPlay
              playsInline
              crossOrigin="anonymous"
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
              className="h-full w-full cursor-pointer"
            >
              {subtitles.map((subtitle) => (
                <track
                  key={subtitle.url}
                  src={subtitle.url}
                  kind="subtitles"
                  srcLang={subtitle.language}
                  label={cleanLabel(subtitle.label)}
                />
              ))}
            </video>

            {buffering && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <LoaderCircle className="h-10 w-10 animate-spin text-white/80" />
              </div>
            )}

            {subtitleToast?.key.startsWith(`${trackKey}:`) && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute right-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:right-4 sm:top-4 sm:text-sm"
              >
                <span className="inline-flex items-center gap-2">
                  <Captions className="h-4 w-4 shrink-0 text-steel" />
                  {subtitleToast.message}
                </span>
              </div>
            )}

            {/* Generation progress: honest ahead/behind-the-playhead signal while
                subtitles stream in, so a slow run doesn't just look broken. */}
            {asr.status === "running" && asr.key === trackKey && (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "pointer-events-none absolute left-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-xs text-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:left-4 sm:top-4",
                  !reduceMotion && "transition-opacity duration-200"
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className={cn("h-3.5 w-3.5 shrink-0 text-primary", !reduceMotion && "animate-spin")} />
                  {(!asr.phase || asr.phase === "preparing") && "Resolving stream for subtitles…"}
                  {asr.phase === "transcribing" &&
                    (aheadBy === undefined
                      ? "Transcribing audio…"
                      : aheadBy >= 0
                        ? `Transcribing — ${formatTime(aheadBy)} ahead of playback`
                        : `Transcribing — falling behind by ${formatTime(-aheadBy)}`)}
                  {asr.phase === "translating" &&
                    (asr.translationTotal
                      ? `Translating — ${asr.translationDone ?? 0}/${asr.translationTotal} languages`
                      : "Translating subtitles…")}
                </span>
                {asr.trackErrors && asr.trackErrors.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-300/90">
                    {asr.trackErrors.map((item) => item.name).join(", ")} failed to translate; the rest are unaffected.
                  </p>
                )}
              </div>
            )}

            {audioFallbackNotice && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute right-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:right-4 sm:top-4 sm:text-sm"
              >
                {audioFallbackNotice}
              </div>
            )}

            {autoSkipToast && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute bottom-20 right-3 z-20 rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:right-4"
              >
                {autoSkipToast}
              </div>
            )}

            {/* Skip intro / outro — bottom right, only while the interval is playing. */}
            {!autoSkipIntro && inOpening && activeSkip?.op && (
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (video && activeSkip.op) video.currentTime = activeSkip.op.end;
                }}
                className="absolute bottom-20 right-3 z-20 rounded-md border border-white/20 bg-black/70 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85 sm:right-4"
              >
                Skip intro
              </button>
            )}
            {inEnding && activeSkip?.ed && (
              <button
                type="button"
                onClick={() => {
                  if (nextEpisodeHref) {
                    window.location.href = nextEpisodeHref;
                    return;
                  }
                  const video = videoRef.current;
                  if (video && activeSkip.ed) video.currentTime = activeSkip.ed.end;
                }}
                className="absolute bottom-20 right-3 z-20 flex items-center gap-1 rounded-md border border-white/20 bg-black/70 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85 sm:right-4"
              >
                {nextEpisodeHref ? "Next episode" : "Skip outro"}
                {nextEpisodeHref && <ChevronRight className="h-4 w-4" />}
              </button>
            )}

            {/* Controls */}
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-16 transition-opacity duration-200",
                controlsVisible || !playing
                  ? "opacity-100"
                  : "pointer-events-none opacity-0"
              )}
            >
              {/* Scrubber */}
              <div className="relative mb-2 flex items-center">
                <div className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/25">
                  <div
                    className="h-full bg-white/35"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute h-1 rounded-full bg-primary"
                  style={{ width: `${progress}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step="any"
                  value={current}
                  aria-label="Seek"
                  onChange={(event) => {
                    const video = videoRef.current;
                    if (!video) return;
                    video.currentTime = Number(event.target.value);
                    setCurrent(Number(event.target.value));
                  }}
                  className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary"
                />
              </div>

              <div className="flex items-center gap-1 text-white">
                <ControlButton onClick={togglePlay} label={playing ? "Pause" : "Play"}>
                  {playing ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                </ControlButton>

                <ControlButton onClick={() => seekBy(-SEEK_STEP)} label="Back 10 seconds">
                  <SkipBack className="h-4.5 w-4.5" />
                </ControlButton>
                <ControlButton onClick={() => seekBy(SEEK_STEP)} label="Forward 10 seconds">
                  <SkipForward className="h-4.5 w-4.5" />
                </ControlButton>

                {/* Volume */}
                <div className="group/vol flex items-center">
                  <ControlButton
                    onClick={() => {
                      const video = videoRef.current;
                      if (video) video.muted = !video.muted;
                    }}
                    label={muted ? "Unmute" : "Mute"}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-5 w-5" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </ControlButton>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    aria-label="Volume"
                    onChange={(event) => {
                      const video = videoRef.current;
                      if (!video) return;
                      video.volume = Number(event.target.value);
                      video.muted = Number(event.target.value) === 0;
                    }}
                    className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
                  />
                </div>

                <span className="ml-2 select-none text-xs tabular-nums text-white/80">
                  {formatTime(current)} / {formatTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  {/* Captions */}
                  <div className="relative">
                    <ControlButton
                      onClick={() => openMenu("captions")}
                      label="Subtitles"
                      active={textTrack >= 0}
                    >
                      {textTrack >= 0 ? (
                        <Captions className="h-5 w-5" />
                      ) : (
                        <CaptionsOff className="h-5 w-5" />
                      )}
                    </ControlButton>
                    {menu === "captions" && (
                      <Menu title="Subtitles" onClose={() => setMenu("none")}>
                        <MenuItem
                          selected={textTrack === -1}
                          onClick={() => {
                            setTextTrack(-1);
                            setMenu("none");
                          }}
                        >
                          Off
                        </MenuItem>
                        {subtitles.map((subtitle, index) => (
                          <MenuItem
                            key={subtitle.url}
                            selected={textTrack === index}
                            onClick={() => {
                              setTextTrack(index);
                              setMenu("none");
                            }}
                          >
                            {cleanLabel(subtitle.label)}
                          </MenuItem>
                        ))}

                        <div className="my-1 border-t border-white/10" />

                        {asr.status === "running" && asr.key === trackKey && (
                          <p className="px-3 py-2 text-xs text-white/65">
                            {asr.phase === "translating"
                              ? "Translating generated subtitles…"
                              : `Transcribing audio${
                                  asr.generatedThrough
                                    ? ` · generated through ${formatTime(asr.generatedThrough)}`
                                    : "…"
                                }`}
                          </p>
                        )}

                        {generatedAvailable &&
                          activeGeneratedTracks.map((track) => (
                            <MenuItem
                              key={track.code}
                              selected={textTrack === track.index}
                              onClick={() => {
                                setTextTrack(track.index);
                                setMenu("none");
                              }}
                            >
                              {track.name} (from {language} audio)
                            </MenuItem>
                          ))}

                        {!generatedAvailable && (
                          <button
                            type="button"
                            onClick={generateSubtitles}
                            disabled={asr.status === "running"}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10 disabled:opacity-60"
                          >
                            <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-none text-primary" />
                            <span>
                              {asr.status === "running"
                                ? asr.phase === "translating"
                                  ? "Translating subtitles…"
                                  : `Transcribing… ${asr.count} lines`
                                : "Generate multilingual subtitles"}
                              <span className="mt-0.5 block text-[11px] text-white/45">
                                {asr.status === "error"
                                  ? asr.message
                                  : "English, Spanish, French, German, Portuguese, Japanese, Hebrew, and Arabic"}
                              </span>
                            </span>
                          </button>
                        )}
                      </Menu>
                    )}
                  </div>

                  {/* Quality, audio, source, subtitle style — everything else the
                      player used to spill into a below-video select bar. */}
                  <div className="relative">
                    <ControlButton
                      onClick={() => openMenu("settings")}
                      label="Settings"
                    >
                      <Settings className="h-5 w-5" />
                    </ControlButton>
                    {menu === "settings" && (
                      <Menu title="Settings" onClose={() => setMenu("none")} wide>
                        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Quality
                        </p>
                        {/* The resolved provider can hand back several renditions of
                            the same stream (real, not fabricated) — prefer picking
                            between those; fall back to hls.js's own adaptive levels
                            for a single multi-rendition HLS manifest. */}
                        {qualityVariants ? (
                          qualityVariants.map((stream) => (
                            <MenuItem
                              key={stream.id}
                              selected={selectedId === stream.id}
                              onClick={() => setSelectedId(stream.id)}
                            >
                              {stream.quality}
                            </MenuItem>
                          ))
                        ) : levels.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-white/50">
                            Quality is fixed for this source.
                          </p>
                        ) : (
                          <>
                            <MenuItem
                              selected={level === -1}
                              onClick={() => {
                                if (hlsRef.current) hlsRef.current.currentLevel = -1;
                                setLevel(-1);
                              }}
                            >
                              Auto
                            </MenuItem>
                            {[...levels].reverse().map((entry) => (
                              <MenuItem
                                key={entry.index}
                                selected={level === entry.index}
                                onClick={() => {
                                  if (hlsRef.current) {
                                    hlsRef.current.currentLevel = entry.index;
                                  }
                                  setLevel(entry.index);
                                }}
                              >
                                {entry.label}
                              </MenuItem>
                            ))}
                          </>
                        )}

                        <div className="my-1 border-t border-white/10" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Audio
                        </p>
                        <MenuItem selected={language === "sub"} onClick={() => setLanguage("sub")}>
                          Japanese · Sub
                        </MenuItem>
                        <MenuItem selected={language === "dub"} onClick={() => setLanguage("dub")}>
                          English · Dub
                        </MenuItem>

                        {/* Source: forces one provider (no race, no fallback) via
                            the `provider` field on /api/anime/streams, and persists
                            the pick via /api/settings/preferred-provider. */}
                        <div className="my-1 border-t border-white/10" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Source
                        </p>
                        <MenuItem
                          selected={preferredProvider === null}
                          onClick={() => chooseProvider(null)}
                        >
                          Auto (fastest available)
                        </MenuItem>
                        {providerList.map((id) => (
                          <MenuItem
                            key={id}
                            selected={preferredProvider === id}
                            onClick={() => chooseProvider(id)}
                          >
                            {id}
                            {activeProvider === id ? " · active" : ""}
                          </MenuItem>
                        ))}

                        <div className="my-1 border-t border-white/10" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Subtitle style
                        </p>
                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Delay</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateAppearance({ delay: Math.round((appearance.delay - 0.5) * 10) / 10 })}
                              className="rounded px-1.5 py-0.5 text-white/70 hover:bg-white/10 hover:text-white"
                              aria-label="Subtitle delay earlier"
                            >
                              −
                            </button>
                            <span className="w-12 text-center tabular-nums text-xs text-white/70">
                              {appearance.delay > 0 ? "+" : ""}
                              {appearance.delay.toFixed(1)}s
                            </span>
                            <button
                              type="button"
                              onClick={() => updateAppearance({ delay: Math.round((appearance.delay + 0.5) * 10) / 10 })}
                              className="rounded px-1.5 py-0.5 text-white/70 hover:bg-white/10 hover:text-white"
                              aria-label="Subtitle delay later"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => updateAppearance({ delay: 0 })}
                              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
                              aria-label="Reset subtitle delay"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Size</span>
                          <div className="flex gap-1">
                            {(["small", "medium", "large"] as const).map((size) => (
                              <button
                                key={size}
                                type="button"
                                onClick={() => updateAppearance({ size })}
                                className={cn(
                                  "rounded px-2 py-1 text-xs capitalize",
                                  appearance.size === size
                                    ? "bg-primary/25 text-primary"
                                    : "text-white/60 hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {size}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Position</span>
                          <div className="flex gap-1">
                            {(["top", "middle", "bottom"] as const).map((position) => (
                              <button
                                key={position}
                                type="button"
                                onClick={() => updateAppearance({ position })}
                                className={cn(
                                  "rounded px-2 py-1 text-xs capitalize",
                                  appearance.position === position
                                    ? "bg-primary/25 text-primary"
                                    : "text-white/60 hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {position}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Color</span>
                          <div className="flex gap-1.5">
                            {SUBTITLE_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => updateAppearance({ color })}
                                aria-label={`Subtitle color ${color}`}
                                style={{ backgroundColor: color }}
                                className={cn(
                                  "h-5 w-5 rounded-full border-2",
                                  appearance.color === color ? "border-primary" : "border-white/20"
                                )}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Text opacity</span>
                          <input
                            type="range"
                            min={0.3}
                            max={1}
                            step={0.05}
                            value={appearance.textOpacity}
                            onChange={(event) =>
                              updateAppearance({ textOpacity: Number(event.target.value) })
                            }
                            aria-label="Subtitle text opacity"
                            className={OPACITY_SLIDER_CLASS}
                          />
                        </div>

                        <div className="flex items-center justify-between px-3 py-1.5 text-sm text-white/85">
                          <span>Background</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={appearance.backgroundOpacity}
                            onChange={(event) =>
                              updateAppearance({ backgroundOpacity: Number(event.target.value) })
                            }
                            aria-label="Subtitle background opacity"
                            className={OPACITY_SLIDER_CLASS}
                          />
                        </div>
                      </Menu>
                    )}
                  </div>

                  <ControlButton
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      if (document.pictureInPictureElement) {
                        void document.exitPictureInPicture();
                      } else {
                        void video.requestPictureInPicture();
                      }
                    }}
                    label="Picture in picture"
                  >
                    <PictureInPicture className="h-5 w-5" />
                  </ControlButton>

                  <ControlButton onClick={toggleFullscreen} label="Fullscreen">
                    {fullscreen ? (
                      <Minimize className="h-5 w-5" />
                    ) : (
                      <Maximize className="h-5 w-5" />
                    )}
                  </ControlButton>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  label,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "rounded-md p-2 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-35",
        active && "text-primary"
      )}
    >
      {children}
    </button>
  );
}

function Menu({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        "absolute bottom-[calc(100%+8px)] right-0 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-black/90 py-1 shadow-xl backdrop-blur",
        wide ? "w-72" : "w-52"
      )}
    >
      <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">
        {title}
      </p>
      {children}
    </div>
  );
}

function MenuItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-white/85 transition-colors hover:bg-white/10"
    >
      <span className="truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 flex-none text-primary" />}
    </button>
  );
}

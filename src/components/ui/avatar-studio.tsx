"use client";

import * as React from "react";
import { Loader2, ShieldCheck, Upload } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { generateAvatar } from "@/lib/api";

interface AvatarStudioProps {
  profileId: string;
  initialAvatar?: string;
  /** When true, show a "Profile name" text input. */
  showNameField?: boolean;
  /** Called when the user picks or confirms an avatar. */
  onComplete?: (avatarUrl: string, name?: string) => void;
}

type Tab = "gallery" | "upload" | "ai";

interface GalleryAvatar {
  id: string;
  url: string;
  label: string;
}

const STYLES: { label: string; value: string }[] = [
  { label: "Shonen", value: "shonen" },
  { label: "Shojo", value: "shojo" },
  { label: "Chibi", value: "chibi" },
  { label: "Cinematic", value: "cinematic" },
];

const fieldClasses =
  "w-full rounded-md border border-white/10 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Profile avatar picker. Netflix-style: a gallery of anime character
 * headshots is the default, first-class path. Uploading your own photo (no
 * AI, no consent gate) is a plain second option. "Turn me anime" (AI
 * restyling of a selfie, PRD R4) is an optional extra behind its own consent
 * gate, kept last and clearly secondary.
 */
export function AvatarStudio({
  profileId,
  initialAvatar,
  showNameField,
  onComplete,
}: AvatarStudioProps) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = React.useState<Tab>("gallery");
  const [name, setName] = React.useState("");

  const nameField = showNameField ? (
    <input
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Profile name"
      className={fieldClasses}
    />
  ) : null;

  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
        <TabButton active={tab === "gallery"} onClick={() => setTab("gallery")}>
          Gallery
        </TabButton>
        <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
          Upload photo
        </TabButton>
        <TabButton active={tab === "ai"} onClick={() => setTab("ai")}>
          Turn me anime
        </TabButton>
      </div>

      {nameField}

      {tab === "gallery" ? (
        <GalleryPicker
          reduceMotion={Boolean(reduceMotion)}
          onSelect={(url) => onComplete?.(url, showNameField ? name : undefined)}
        />
      ) : null}

      {tab === "upload" ? (
        <UploadPicker
          onConfirm={(url) => onComplete?.(url, showNameField ? name : undefined)}
        />
      ) : null}

      {tab === "ai" ? (
        <AiGenerator
          profileId={profileId}
          initialAvatar={initialAvatar}
          reduceMotion={Boolean(reduceMotion)}
          onConfirm={(url) => onComplete?.(url, showNameField ? name : undefined)}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Default path: pick an anime character headshot, no AI and no consent needed. */
function GalleryPicker({
  reduceMotion,
  onSelect,
}: {
  reduceMotion: boolean;
  onSelect: (url: string) => void;
}) {
  const [avatars, setAvatars] = React.useState<GalleryAvatar[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/avatar")
      .then((res) => (res.ok ? res.json() : null))
      .then((result: { avatars?: GalleryAvatar[] } | null) => {
        if (!cancelled && result?.avatars) setAvatars(result.avatars);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid max-h-72 grid-cols-5 gap-3 overflow-y-auto pr-1">
      {avatars.map((avatar, i) => (
        <motion.button
          key={avatar.id}
          type="button"
          onClick={() => onSelect(avatar.url)}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, delay: reduceMotion ? 0 : i * 0.015 }}
          aria-label={`Use ${avatar.label} as profile picture`}
          className="aspect-square overflow-hidden rounded-full ring-1 ring-white/10 transition-all hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatar.url}
            alt={avatar.label}
            className="h-full w-full object-cover"
          />
        </motion.button>
      ))}
    </div>
  );
}

/** Plain profile photo. No AI, no biometric consent — the photo is used as-is. */
function UploadPicker({ onConfirm }: { onConfirm: (url: string) => void }) {
  const [preview, setPreview] = React.useState<string | undefined>(undefined);

  const handleFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-card px-4 py-8 text-center transition-colors hover:bg-elevated",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
        )}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {preview ? (
          <div className="h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Photo preview" className="h-full w-full object-cover" />
          </div>
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" />
        )}
        <span className="text-sm text-muted-foreground">
          {preview ? "Photo selected" : "Upload a photo"}
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        Used as your profile picture as-is. No AI processing.
      </p>

      <button
        type="button"
        disabled={!preview}
        onClick={() => preview && onConfirm(preview)}
        className="rounded-md border border-steel/60 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Use this photo
      </button>
    </div>
  );
}

/** Optional extra: selfie -> AI anime avatar (PRD R4). Kept behind its own consent gate. */
function AiGenerator({
  profileId,
  initialAvatar,
  reduceMotion,
  onConfirm,
}: {
  profileId: string;
  initialAvatar?: string;
  reduceMotion: boolean;
  onConfirm: (url: string) => void;
}) {
  const [imageDataUrl, setImageDataUrl] = React.useState<string | undefined>(undefined);
  const [consent, setConsent] = React.useState(false);
  const [style, setStyle] = React.useState("shonen");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [avatarUrl, setAvatarUrl] = React.useState<string | undefined>(initialAvatar);

  const handleFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
      setAvatarUrl(undefined);
      setError(undefined);
    };
    reader.readAsDataURL(file);
  };

  const canGenerate = Boolean(imageDataUrl) && consent && !loading;

  const handleGenerate = async () => {
    if (!imageDataUrl || !consent) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await generateAvatar({
        profileId,
        imageDataUrl,
        style,
        consent: true,
      });
      setAvatarUrl(res.avatarUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("501")) {
        setError(
          "AI avatar generation isn't available yet. Try the gallery or upload a photo instead."
        );
      } else if (message.includes("429")) {
        setError("Too many tries, wait a minute.");
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Optional: let AI restyle a selfie into an anime avatar. This is separate from the
        gallery and upload options above.
      </p>

      {avatarUrl ? (
        <div className="flex flex-col items-center gap-3">
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="h-32 w-32 overflow-hidden rounded-full ring-2 ring-steel/60"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt="Generated anime avatar" className="h-full w-full object-cover" />
          </motion.div>
          <p className="text-sm text-muted-foreground">Your anime avatar</p>

          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => onConfirm(avatarUrl)}
              className="flex-1 rounded-md border border-steel/60 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Use this avatar
            </button>
            <button
              type="button"
              onClick={() => setAvatarUrl(undefined)}
              className="flex-1 rounded-md border border-white/10 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <>
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-card px-4 py-8 text-center transition-colors hover:bg-elevated",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {imageDataUrl ? (
              <div className="h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageDataUrl} alt="Selfie preview" className="h-full w-full object-cover" />
              </div>
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">
              {imageDataUrl ? "Selfie selected" : "Upload a selfie"}
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  style === s.value
                    ? "bg-primary border-steel/60 text-primary-foreground"
                    : "bg-elevated border-white/10 text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/10 bg-elevated text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <span>
              I agree to let Pezzy process this photo to generate an anime avatar. It is used for
              generation only and not stored.
            </span>
          </label>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-2 rounded-md border border-steel/60 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating your avatar...
              </>
            ) : (
              "Turn me anime"
            )}
          </button>

          {error && (
            <p role="alert" className="text-sm text-accent">
              {error}
            </p>
          )}
        </>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-steel" />
        Your photo never leaves this generation step and is not stored.
      </p>
    </div>
  );
}

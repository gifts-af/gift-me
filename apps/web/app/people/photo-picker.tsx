"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { SaveResult } from "@/modules/concierge";

const BUCKET = "person-photos";

type Action = (previous: SaveResult | null, formData: FormData) => Promise<SaveResult>;

/** The two storage calls the picker needs, so tests can pass a fake. */
export type PhotoStorage = {
  upload: (path: string, blob: Blob) => Promise<{ error: { message: string } | null }>;
  remove: (path: string) => Promise<{ error: { message: string } | null }>;
};

function supabaseStorage(): PhotoStorage {
  const bucket = createClient().storage.from(BUCKET);
  return {
    upload: (path, blob) => bucket.upload(path, blob, { contentType: "image/jpeg" }),
    remove: (path) => bucket.remove([path]),
  };
}

/** Draws the image onto a canvas, longest side `px`, and returns a JPEG. Rejects if it can't be decoded. */
export async function resizeToJpeg(file: File, px: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, px / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not encode the photo");
  return blob;
}

/**
 * Pick or take a photo, shrink it, upload it, point the person at it, and only
 * then delete the old object. On any failure the old photo and its object stay.
 *
 * `userId` comes from the server (the signed-in user), because the storage
 * folder is `<user>/<person>/` and the server already knows who that is.
 * `maxUploadBytes` and `px` come from app settings, read on the server.
 */
export function PhotoPicker({
  personId,
  userId,
  currentPath,
  maxUploadBytes,
  px,
  action,
  onSaved,
  storage,
  resize = resizeToJpeg,
}: {
  personId: string;
  userId: string;
  currentPath: string | null;
  maxUploadBytes: number;
  px: number;
  action: Action;
  onSaved?: (path: string) => void;
  storage?: PhotoStorage;
  resize?: (file: File, px: number) => Promise<Blob>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(currentPath);

  async function onPick(file: File) {
    setError(null);
    if (file.size > maxUploadBytes) {
      setError("That photo is too big.");
      return;
    }
    setBusy(true);
    try {
      let blob: Blob;
      try {
        blob = await resize(file, px);
      } catch {
        setError("That file isn't a photo we can use.");
        return;
      }
      const store = storage ?? supabaseStorage();
      const newPath = `${userId}/${personId}/${crypto.randomUUID()}.jpg`;
      const uploaded = await store.upload(newPath, blob);
      if (uploaded.error) {
        setError("The photo didn't upload. Try again.");
        return;
      }
      const form = new FormData();
      form.set("id", personId);
      form.set("path", newPath);
      const result = await action(null, form);
      if (!result.ok) {
        await store.remove(newPath); // tidy the orphan; the old photo stays
        setError(result.error);
        return;
      }
      if (path) await store.remove(path); // best effort: a leftover object is harmless
      setPath(newPath);
      onSaved?.(newPath);
    } catch {
      setError("The photo didn't upload. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="user"
        aria-label="Choose a photo"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onPick(file);
        }}
      />
      <Button type="button" variant="outline" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
        {busy ? "Saving photo…" : path ? "Change photo" : "Add a photo"}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

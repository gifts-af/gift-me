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

/** Deleting is best effort: a failure is logged and never fails the save. */
async function tryRemove(store: PhotoStorage, path: string) {
  try {
    await store.remove(path);
  } catch (error) {
    console.error("Could not remove photo object", path, error);
  }
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

type Resize = (file: File, px: number) => Promise<Blob>;

/** Checks the file is small enough and decodes; returns the shrunken JPEG or a plain-words error. */
export async function prepareJpeg(o: {
  file: File;
  px: number;
  maxUploadBytes: number;
  resize?: Resize;
}): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  if (o.file.size > o.maxUploadBytes) return { ok: false, error: "That photo is too big." };
  try {
    return { ok: true, blob: await (o.resize ?? resizeToJpeg)(o.file, o.px) };
  } catch {
    return { ok: false, error: "That file isn't a photo we can use." };
  }
}

/**
 * Shrink, upload, point the person at the new object, and only then delete the
 * old one (best effort). On any failure the new object is removed and the old
 * photo stays. Shared by the picker (existing person) and the add form.
 */
export async function savePersonPhoto(o: {
  file: File;
  personId: string;
  userId: string;
  px: number;
  maxUploadBytes: number;
  action: Action;
  currentPath?: string | null;
  storage?: PhotoStorage;
  resize?: Resize;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const prepared = await prepareJpeg(o);
  if (!prepared.ok) return prepared;
  try {
    const store = o.storage ?? supabaseStorage();
    const newPath = `${o.userId}/${o.personId}/${crypto.randomUUID()}.jpg`;
    const uploaded = await store.upload(newPath, prepared.blob);
    if (uploaded.error) return { ok: false, error: "The photo didn't upload. Try again." };
    const form = new FormData();
    form.set("id", o.personId);
    form.set("path", newPath);
    let result: SaveResult;
    try {
      result = await o.action(null, form);
    } catch {
      result = { ok: false, error: "The photo didn't save. Try again." };
    }
    if (!result.ok) {
      await tryRemove(store, newPath); // tidy the orphan; the old photo stays
      return { ok: false, error: result.error };
    }
    if (o.currentPath) await tryRemove(store, o.currentPath); // best effort: a leftover object is harmless
    return { ok: true, path: newPath };
  } catch {
    return { ok: false, error: "The photo didn't upload. Try again." };
  }
}

/**
 * Pick or take a photo for an existing person and save it as soon as it is chosen.
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
  resize?: Resize;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(currentPath);

  async function onPick(file: File) {
    setError(null);
    setBusy(true);
    try {
      const result = await savePersonPhoto({
        file, personId, userId, px, maxUploadBytes, action, currentPath: path, storage, resize,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPath(result.path);
      onSaved?.(result.path);
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

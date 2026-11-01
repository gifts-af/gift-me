// Reading the current tab. Only canCapture runs when the popup opens; the page
// itself is read only when the user clicks Save (C-2).

export type CollectedPage = { url: string; title: string; text: string; screenshot: Blob };

/** Chrome refuses scripts on chrome://, the Web Store and similar pages. */
export async function canCapture(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
    return true;
  } catch {
    return false;
  }
}

export async function collectPage(
  tabId: number,
  opts: { jpegQuality: number; textMax: number },
): Promise<CollectedPage> {
  // The func runs in the page, so it must stay self-contained.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (max: number) => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, max),
    }),
    args: [opts.textMax],
  });
  const page = injection.result as { url: string; title: string; text: string };
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: opts.jpegQuality });
  return { ...page, screenshot: dataUrlToBlob(dataUrl) };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",", 2);
  const type = /^data:([^;]+)/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

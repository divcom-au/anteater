// Service worker: owns the webhook call so it survives the popup closing.

const WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/3293040/45si2d0/";
const TIMEOUT_MS = 30000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "submit-report") return false;
  submitReport(message.report).then(sendResponse);
  return true; // keep the channel open for the async response
});

async function submitReport(report) {
  const { secret, reporter } = await chrome.storage.local.get(["secret", "reporter"]);

  if (!secret || !reporter) {
    return { ok: false, error: "Please set your name and the shared secret in plugin Settings." };
  }

  const submittedAt = new Date().toISOString();
  const fields = {
    secret,
    brand: report.brand,
    title: report.title,
    description: report.description || "",
    reporter,
    page_url: report.pageUrl || "",
    page_title: report.pageTitle || "",
    submitted_at: submittedAt,
    user_agent: navigator.userAgent,
    extension_version: chrome.runtime.getManifest().version,
    has_screenshot: report.screenshot ? "true" : "false",
  };
  const filename = `bug-${submittedAt.replace(/[:.]/g, "-")}.jpg`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Multipart form: Zapier receives the screenshot as a real file it can
    // attach in Asana. The browser sets the Content-Type and boundary.
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
    if (report.screenshot) {
      const blob = await (await fetch(report.screenshot)).blob();
      body.append("screenshot", blob, filename);
    }

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `Zapier responded with HTTP ${response.status}.` };
    }
    return { ok: true };
  } catch (err) {
    const error =
      err.name === "AbortError"
        ? "Timed out waiting for Zapier."
        : `Could not reach Zapier (${err.message}).`;
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

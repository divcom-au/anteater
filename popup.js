const MAX_IMAGE_WIDTH = 2000; // downscale wider captures to keep the payload small
const JPEG_QUALITY = 0.85;
const MIN_CROP_PX = 5; // smaller drags count as a click and clear the crop
const THANKS_MS = 2500; // how long the thank-you message shows before the popup closes

const form = document.getElementById("form");
const brandSelect = document.getElementById("brand");
const titleInput = document.getElementById("title");
const descriptionInput = document.getElementById("description");
const submitButton = document.getElementById("submit");
const statusBox = document.getElementById("status");

const shotSection = document.getElementById("shotSection");
const shotError = document.getElementById("shotError");
const includeShot = document.getElementById("includeShot");
const cropArea = document.getElementById("cropArea");
const shot = document.getElementById("shot");
const selection = document.getElementById("selection");
const clearCropButton = document.getElementById("clearCrop");

let hasScreenshot = false;
let crop = null; // { x, y, w, h } in displayed pixels, or null for the full viewport
let dragStart = null;

for (const brand of BRANDS) {
  brandSelect.add(new Option(brand, brand));
}

// Remember the last brand used, since most people report for the same one.
chrome.storage.local.get(["lastBrand", "secret", "reporter"]).then(({ lastBrand, secret, reporter }) => {
  if (lastBrand && BRANDS.includes(lastBrand)) brandSelect.value = lastBrand;

  // Without a name and secret nothing can be sent, so show a prompt instead of the form.
  if (!reporter || !secret) {
    const missing = !reporter && !secret ? "your name and the shared secret" : !reporter ? "your name" : "the shared secret";
    document.getElementById("setupMessage").textContent = `Please set ${missing} in plugin Settings`;
    document.getElementById("setup").hidden = false;
    form.hidden = true;
    return;
  }

  captureViewport();
});

for (const id of ["settings", "openSettings"]) {
  document.getElementById(id).addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

// ---- Screenshot capture and crop ----

async function captureViewport() {
  try {
    shot.src = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    await shot.decode();
    hasScreenshot = true;
    shotSection.hidden = false;
  } catch (err) {
    // Chrome blocks capture on its own pages (chrome://, the Web Store, etc.).
    shotError.textContent = "This page can't be captured. You can still send a report without a screenshot.";
    shotError.hidden = false;
  }
}

function pointInImage(event) {
  const rect = shot.getBoundingClientRect();
  return {
    x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
  };
}

function renderCrop() {
  selection.hidden = !crop;
  clearCropButton.hidden = !crop;
  if (!crop) return;
  selection.style.left = `${crop.x}px`;
  selection.style.top = `${crop.y}px`;
  selection.style.width = `${crop.w}px`;
  selection.style.height = `${crop.h}px`;
}

cropArea.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  cropArea.setPointerCapture(event.pointerId);
  dragStart = pointInImage(event);
  crop = null;
  renderCrop();
});

cropArea.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  const point = pointInImage(event);
  crop = {
    x: Math.min(dragStart.x, point.x),
    y: Math.min(dragStart.y, point.y),
    w: Math.abs(point.x - dragStart.x),
    h: Math.abs(point.y - dragStart.y),
  };
  renderCrop();
});

function endDrag() {
  if (!dragStart) return;
  dragStart = null;
  if (crop && (crop.w < MIN_CROP_PX || crop.h < MIN_CROP_PX)) crop = null;
  renderCrop();
}
cropArea.addEventListener("pointerup", endDrag);
cropArea.addEventListener("pointercancel", endDrag);

clearCropButton.addEventListener("click", () => {
  crop = null;
  renderCrop();
});

// Returns the (optionally cropped) screenshot as a JPEG data URL.
function buildImage() {
  // The preview is scaled down, so map the crop back to captured pixels.
  const scale = shot.naturalWidth / shot.clientWidth;
  const source = crop
    ? {
        x: Math.round(crop.x * scale),
        y: Math.round(crop.y * scale),
        w: Math.round(crop.w * scale),
        h: Math.round(crop.h * scale),
      }
    : { x: 0, y: 0, w: shot.naturalWidth, h: shot.naturalHeight };

  const outScale = Math.min(1, MAX_IMAGE_WIDTH / source.w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.w * outScale));
  canvas.height = Math.max(1, Math.round(source.h * outScale));
  canvas
    .getContext("2d")
    .drawImage(shot, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

// ---- Submit ----

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  showStatus("Sending…");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const brand = brandSelect.value;

  const result = await chrome.runtime.sendMessage({
    type: "submit-report",
    report: {
      brand,
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
      pageUrl: tab?.url,
      pageTitle: tab?.title,
      screenshot: hasScreenshot && includeShot.checked ? buildImage() : null,
    },
  });

  submitButton.disabled = false;

  if (result?.ok) {
    chrome.storage.local.set({ lastBrand: brand });
    // Swap the form for a thank-you message, then close the popup.
    form.hidden = true;
    statusBox.hidden = true;
    document.getElementById("thanks").hidden = false;
    setTimeout(() => window.close(), THANKS_MS);
  } else {
    showStatus(result?.error || "Something went wrong.", true);
  }
});

function showStatus(text, isError = false) {
  statusBox.textContent = text;
  statusBox.classList.toggle("error", isError);
  statusBox.hidden = false;
  statusBox.scrollIntoView({ block: "nearest" }); // it can sit below the fold
}

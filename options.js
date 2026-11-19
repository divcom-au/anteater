const FIELDS = ["secret", "reporter"];

const form = document.getElementById("form");
const statusBox = document.getElementById("status");

chrome.storage.local.get(FIELDS).then((saved) => {
  for (const field of FIELDS) {
    document.getElementById(field).value = saved[field] || "";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const values = {};
  for (const field of FIELDS) {
    values[field] = document.getElementById(field).value.trim();
  }

  await chrome.storage.local.set(values);
  statusBox.textContent = "Saved.";
  statusBox.hidden = false;
});

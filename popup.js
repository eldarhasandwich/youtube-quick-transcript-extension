const checkbox = document.getElementById('metadata');
const status = document.getElementById('status');
chrome.storage.local.get({includeMetadata: true}).then(settings => {
  checkbox.checked = settings.includeMetadata;
  checkbox.disabled = false;
}).catch(() => {status.textContent = 'Could not load settings. Reopen this popup.';});
checkbox.addEventListener('change', async () => {
  checkbox.disabled = true;
  try {
    await chrome.storage.local.set({includeMetadata: checkbox.checked});
    status.textContent = 'Saved. Applies to your next copy.';
  } catch {
    checkbox.checked = !checkbox.checked;
    status.textContent = 'Could not save. Please try again.';
  } finally {checkbox.disabled = false;}
});

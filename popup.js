const checkbox = document.getElementById('metadata');
const thumbnailsCheckbox = document.getElementById('show-thumbnails');
const status = document.getElementById('status');
chrome.storage.local.get({includeMetadata: true, showButtonOnThumbnails: false}).then(settings => {
  checkbox.checked = settings.includeMetadata;
  checkbox.disabled = false;
  thumbnailsCheckbox.checked = settings.showButtonOnThumbnails === true;
  thumbnailsCheckbox.disabled = false;
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
thumbnailsCheckbox.addEventListener('change', async () => {
  thumbnailsCheckbox.disabled = true;
  try {
    await chrome.storage.local.set({showButtonOnThumbnails: thumbnailsCheckbox.checked});
    status.textContent = 'Saved. Thumbnail buttons update immediately.';
  } catch {
    thumbnailsCheckbox.checked = !thumbnailsCheckbox.checked;
    status.textContent = 'Could not save. Please try again.';
  } finally {thumbnailsCheckbox.disabled = false;}
});

let banner;

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'signal-assistant-banner';
  banner.style.position = 'fixed';
  banner.style.right = '12px';
  banner.style.bottom = '12px';
  banner.style.padding = '10px 12px';
  banner.style.zIndex = '999999';
  banner.style.borderRadius = '8px';
  banner.style.fontFamily = 'Inter, sans-serif';
  banner.style.fontSize = '12px';
  banner.style.color = '#fff';
  banner.style.background = 'rgba(15, 23, 42, 0.92)';
  banner.style.border = '1px solid rgba(148, 163, 184, 0.5)';
  banner.textContent = 'Signal Assistant ready';
  document.body.appendChild(banner);
  return banner;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'SHOW_SIGNAL_BANNER') return;
  const b = ensureBanner();
  const { signal, confidence } = message.payload || {};

  if (signal === 'CALL') {
    b.style.borderColor = '#10b981';
  } else if (signal === 'PUT') {
    b.style.borderColor = '#ef4444';
  } else {
    b.style.borderColor = '#f59e0b';
  }

  b.textContent = `Signal: ${signal} | Confidence: ${confidence}%`;
});

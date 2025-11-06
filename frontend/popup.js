// popup.js - Handles popup UI interactions

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scanBtn');
  const exportBtn = document.getElementById('exportBtn');
  const loading = document.getElementById('loading');
  const resultsSection = document.getElementById('resultsSection');
  const leaksList = document.getElementById('leaksList');
  const emptyState = document.getElementById('emptyState');
  const autoScanToggle = document.getElementById('autoScanToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const statusDetail = document.getElementById('status-detail');

  // Load settings
  const settings = await chrome.storage.local.get(['autoScan', 'notifications']);
  autoScanToggle.checked = settings.autoScan !== false;
  notificationsToggle.checked = settings.notifications !== false;

  // Check backend status
  checkBackendStatus();
  loadLastScanResults();

  // Event listeners
  scanBtn.addEventListener('click', scanCurrentPage);
  exportBtn.addEventListener('click', exportReport);

  autoScanToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoScan: e.target.checked });
  });

  notificationsToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ notifications: e.target.checked });
  });

  async function checkBackendStatus() {
    try {
      // Use message passing to background script instead of direct fetch
      const response = await chrome.runtime.sendMessage({ action: 'pingBackend' });
      if (response && response.online) {
        statusDetail.innerHTML = '<strong>Active</strong><br>Backend connected ✓';
      } else {
        throw new Error('Backend not responding');
      }
    } catch (error) {
      statusDetail.innerHTML = '<strong style="color: #d32f2f;">Backend Offline</strong><br>Using local detection';
    }
  }

  async function scanCurrentPage() {
    loading.style.display = 'block';
    resultsSection.style.display = 'none';
    emptyState.style.display = 'none';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('chat.openai.com') &&
          !tab.url.includes('claude.ai') &&
          !tab.url.includes('gemini.google.com') &&
          !tab.url.includes('copilot.microsoft.com')) {
        alert('Please open an AI chat platform (ChatGPT, Claude, Gemini, or Copilot) to scan.');
        loading.style.display = 'none';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'scanPage' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError);
        }
        setTimeout(loadLastScanResults, 2000);
      });
    } catch (error) {
      console.error('Error scanning page:', error);
      loading.style.display = 'none';
      alert('Error scanning page. Make sure you are on a supported AI chat platform.');
    }
  }

  async function loadLastScanResults() {
    loading.style.display = 'none';

    const data = await chrome.storage.local.get(['lastHistoryScan']);

    if (!data.lastHistoryScan || !data.lastHistoryScan.findings) {
      emptyState.style.display = 'block';
      return;
    }

    const results = data.lastHistoryScan;

    if (results.findings.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    resultsSection.style.display = 'block';
    leaksList.innerHTML = '';

    // Group findings by type
    const groupedFindings = {};
    results.findings.forEach(finding => {
      const type = detectPIIType(finding.original);
      if (!groupedFindings[type]) {
        groupedFindings[type] = [];
      }
      groupedFindings[type].push(finding);
    });

    // Display grouped findings
    Object.entries(groupedFindings).forEach(([type, findings]) => {
      const typeHeader = document.createElement('div');
      typeHeader.style.cssText = 'font-weight: 600; margin: 15px 0 8px 0; color: #333; font-size: 13px;';
      typeHeader.textContent = `${type} (${findings.length})`;
      leaksList.appendChild(typeHeader);

      findings.forEach(finding => {
        const leakItem = document.createElement('div');
        leakItem.className = 'leak-item';
        leakItem.innerHTML = `
          <div class="leak-type">${type}</div>
          <div style="display: flex; align-items: center; gap: 8px; margin: 8px 0;">
            <code style="background: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; flex: 1;">${escapeHtml(finding.original)}</code>
            <span style="color: #666;">→</span>
            <code style="background: #e8f5e9; padding: 4px 8px; border-radius: 4px; font-size: 12px; flex: 1;">${escapeHtml(finding.replacement)}</code>
          </div>
          <div class="leak-actions">
            <button class="copy-btn" data-value="${escapeHtml(finding.original)}">Copy Original</button>
          </div>
        `;
        leaksList.appendChild(leakItem);
      });
    });

    // Add scan summary
    const summary = document.createElement('div');
    summary.style.cssText = 'margin-top: 20px; padding: 12px; background: #e3f2fd; border-radius: 6px; font-size: 12px;';
    summary.innerHTML = `
      <strong>Scan Summary:</strong><br>
      📊 ${results.totalMessages || 0} messages scanned<br>
      ⚠️ ${results.leaksFound || 0} PII instances found<br>
      🕐 ${new Date(results.timestamp).toLocaleString()}
    `;
    leaksList.appendChild(summary);

    // Add copy functionality
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.value);
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Original', 2000);
      });
    });
  }

  function detectPIIType(text) {
    if (/@/.test(text)) return '📧 Email';
    if (/^\+?\d{10,}/.test(text)) return '📱 Phone';
    if (/^\d{3}-\d{2}-\d{4}$/.test(text)) return '🆔 SSN';
    if (/^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/.test(text)) return '💳 Credit Card';
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) return '🌐 IP Address';
    if (/^\d{1,5}\s/.test(text)) return '🏠 Address';
    if (/[A-Z][a-z]+\s[A-Z][a-z]+/.test(text)) return '👤 Name';
    return '🔒 Sensitive Info';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function exportReport() {
    const data = await chrome.storage.local.get(['lastHistoryScan']);

    if (!data.lastHistoryScan) {
      alert('No scan results available. Please scan first.');
      return;
    }

    const results = data.lastHistoryScan;
    const report = generateReport(results);

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privacy-leak-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function generateReport(results) {
    let report = '╔════════════════════════════════════════════════════════╗\n';
    report += '║       PRIVACY GUARDIAN - LEAK DETECTION REPORT        ║\n';
    report += '╚════════════════════════════════════════════════════════╝\n\n';
    report += `Generated: ${new Date().toLocaleString()}\n`;
    report += `Platform: ${new URL(results.url).hostname}\n`;
    report += `Messages Scanned: ${results.totalMessages || 0}\n`;
    report += `Total Leaks Found: ${results.leaksFound || 0}\n\n`;

    if (results.findings && results.findings.length > 0) {
      report += '═══════════════════════════════════════════════════════\n';
      report += 'DETECTED SENSITIVE INFORMATION\n';
      report += '═══════════════════════════════════════════════════════\n\n';

      results.findings.forEach((finding, index) => {
        report += `${index + 1}. Original: ${finding.original}\n`;
        report += `   Suggested Replacement: ${finding.replacement}\n\n`;
      });

      report += '\n═══════════════════════════════════════════════════════\n';
      report += 'RECOMMENDED ACTIONS\n';
      report += '═══════════════════════════════════════════════════════\n\n';
      report += '1. Review each detected leak carefully\n\n';
      report += '2. Contact AI platforms to request data deletion:\n';
      report += '   • ChatGPT: privacy@openai.com\n';
      report += '   • Claude: privacy@anthropic.com\n';
      report += '   • Gemini: https://support.google.com/policies/\n';
      report += '   • Copilot: privacy.microsoft.com\n\n';
      report += '3. Security measures:\n';
      report += '   • Change passwords if exposed\n';
      report += '   • Update credit cards if numbers were shared\n';
      report += '   • Monitor accounts for suspicious activity\n';
      report += '   • Consider credit monitoring services\n\n';
      report += '4. Prevention:\n';
      report += '   • Always use Privacy Guardian before sending\n';
      report += '   • Use anonymized data when possible\n';
      report += '   • Avoid sharing real personal information\n';
    } else {
      report += '✅ No sensitive information detected.\n';
      report += '   Your conversations appear to be privacy-safe!\n';
    }

    report += '\n═══════════════════════════════════════════════════════\n';
    report += 'Report generated by Privacy Guardian Browser Extension\n';
    report += '═══════════════════════════════════════════════════════\n';

    return report;
  }
});

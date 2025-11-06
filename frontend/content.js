// content.js - Firefox Compatible Version

const CONFIG = {
  platforms: {
    'chat.openai.com': {
      inputSelector: '#prompt-textarea',
      submitSelector: 'button[data-testid="send-button"]',
      messageSelector: '[data-message-author-role="user"]'
    },
    'claude.ai': {
      inputSelector: 'div[contenteditable="true"][data-placeholder]',
      submitSelector: 'button[aria-label="Send Message"]',
      messageSelector: 'div[class*="font-user-message"]'
    },
    'gemini.google.com': {
      inputSelector: 'rich-textarea[aria-label*="Enter"]',
      submitSelector: 'button[aria-label*="Send"]',
      messageSelector: 'message-content[author="user"]'
    },
    'copilot.microsoft.com': {
      inputSelector: 'textarea[aria-label="Ask me anything"]',
      submitSelector: 'button[aria-label="Submit"]',
      messageSelector: '.user-message'
    }
  }
};

class PrivacyGuardian {
  constructor() {
    // Firefox compatibility
    this.runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
    this.platform = this.detectPlatform();
    this.isProcessing = false;
    this.init();
  }

  detectPlatform() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(CONFIG.platforms)) {
      if (hostname.includes(domain)) {
        return { domain, ...config };
      }
    }
    return null;
  }

  init() {
    if (!this.platform) {
      console.log('Privacy Guardian: Platform not supported');
      return;
    }

    console.log('Privacy Guardian: Initialized on', this.platform.domain);

    this.interceptSubmissions();
    this.scanExistingMessages();

    this.runtime.onMessage.addListener(this.handleMessage.bind(this));
  }

  interceptSubmissions() {
    document.addEventListener('click', async (e) => {
      const submitButton = e.target.closest(this.platform.submitSelector);
      if (submitButton && !this.isProcessing) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.handleSubmission(submitButton);
      }
    }, true);

    document.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !this.isProcessing) {
        const inputElement = document.querySelector(this.platform.inputSelector);
        if (inputElement && (document.activeElement === inputElement || inputElement.contains(document.activeElement))) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await this.handleSubmission(null);
        }
      }
    }, true);
  }

  async handleSubmission(button) {
    const inputElement = document.querySelector(this.platform.inputSelector);
    if (!inputElement) return;

    const userText = this.extractText(inputElement);
    if (!userText.trim()) return;

    this.isProcessing = true;

    try {
      const piiCheck = await this.checkForPII(userText);

      if (piiCheck.hasPII) {
        const anonymizeResult = await this.anonymizeText(userText);
        const userChoice = await this.showWarningModal(userText, anonymizeResult);

        if (userChoice === 'cancel') {
          this.isProcessing = false;
          return;
        } else if (userChoice === 'anonymize') {
          this.setInputText(inputElement, anonymizeResult.anonymized_text);
          await this.delay(100);
        }
      }

      this.triggerSubmission(button || inputElement);

    } catch (error) {
      console.error('Privacy Guardian: Error', error);
      this.triggerSubmission(button || inputElement);
    } finally {
      this.isProcessing = false;
    }
  }

  extractText(element) {
    if (element.value !== undefined) return element.value;
    if (element.textContent) return element.textContent;
    return element.innerText || '';
  }

  setInputText(element, text) {
    if (element.value !== undefined) {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async checkForPII(text) {
    return new Promise((resolve) => {
      this.runtime.sendMessage(
        { action: 'checkPII', text },
        (response) => resolve(response || { hasPII: false })
      );
    });
  }

  async anonymizeText(text) {
    return new Promise((resolve) => {
      this.runtime.sendMessage(
        { action: 'anonymize', text },
        (response) => resolve(response || { anonymized_text: text, replacements: [] })
      );
    });
  }

  async showWarningModal(originalText, anonymizeResult) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'privacy-guardian-overlay';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.85); z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white; padding: 30px; border-radius: 12px;
        max-width: 600px; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      `;

      const replacementsHtml = anonymizeResult.replacements && anonymizeResult.replacements.length > 0
        ? `<div style="margin: 15px 0; padding: 15px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
            <strong style="color: #856404; display: block; margin-bottom: 10px;">🔍 Detected PII:</strong>
            <ul style="margin: 0; padding-left: 20px; color: #856404;">
              ${anonymizeResult.replacements.map(r =>
                `<li style="margin: 5px 0;"><code style="background: #fff; padding: 2px 6px; border-radius: 3px;">${this.escapeHtml(r.original)}</code> → <code style="background: #fff; padding: 2px 6px; border-radius: 3px;">${this.escapeHtml(r.replacement)}</code></li>`
              ).join('')}
            </ul>
          </div>`
        : '<p style="margin: 15px 0; color: #856404; background: #fff3cd; padding: 12px; border-radius: 6px;">⚠️ Potential PII detected in your message</p>';

      modal.innerHTML = `
        <h2 style="color: #d32f2f; margin: 0 0 15px 0; display: flex; align-items: center;">
          <span style="font-size: 28px; margin-right: 10px;">🛡️</span>
          Privacy Alert
        </h2>
        ${replacementsHtml}
        <div style="margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-weight: 600;">📝 Original Message:</p>
          <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; max-height: 150px; overflow-y: auto; font-size: 14px; white-space: pre-wrap;">${this.escapeHtml(originalText)}</div>
        </div>
        ${anonymizeResult.anonymized_text && anonymizeResult.anonymized_text !== originalText ? `
          <div style="margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #2e7d32;">✅ Anonymized Version:</p>
            <div style="background: #e8f5e9; padding: 12px; border-radius: 6px; max-height: 150px; overflow-y: auto; font-size: 14px; white-space: pre-wrap; border: 2px solid #4caf50;">${this.escapeHtml(anonymizeResult.anonymized_text)}</div>
          </div>
        ` : ''}
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button id="pg-cancel" style="
            padding: 12px 20px; background: #d32f2f; color: white;
            border: none; border-radius: 6px; cursor: pointer;
            font-weight: 600; font-size: 14px;
          ">❌ Cancel</button>
          ${anonymizeResult.anonymized_text && anonymizeResult.anonymized_text !== originalText ? `
            <button id="pg-anonymize" style="
              padding: 12px 20px; background: #2e7d32; color: white;
              border: none; border-radius: 6px; cursor: pointer;
              font-weight: 600; font-size: 14px;
            ">✅ Use Anonymized</button>
          ` : ''}
          <button id="pg-proceed" style="
            padding: 12px 20px; background: #666; color: white;
            border: none; border-radius: 6px; cursor: pointer; font-size: 14px;
          ">⚠️ Proceed Anyway</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      document.getElementById('pg-cancel').onclick = () => {
        overlay.remove();
        resolve('cancel');
      };

      document.getElementById('pg-proceed').onclick = () => {
        overlay.remove();
        resolve('proceed');
      };

      const anonymizeBtn = document.getElementById('pg-anonymize');
      if (anonymizeBtn) {
        anonymizeBtn.onclick = () => {
          overlay.remove();
          resolve('anonymize');
        };
      }
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  triggerSubmission(buttonOrInput) {
    setTimeout(() => {
      const submitButton = document.querySelector(this.platform.submitSelector);
      if (submitButton) {
        submitButton.click();
      }
    }, 150);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async scanExistingMessages() {
    const messages = document.querySelectorAll(this.platform.messageSelector);
    const userMessages = [];

    messages.forEach(msg => {
      const text = this.extractText(msg);
      if (text && text.trim().length > 10) {
        userMessages.push({ text: text.trim() });
      }
    });

    if (userMessages.length > 0) {
      this.runtime.sendMessage({
        action: 'scanHistory',
        messages: userMessages,
        url: window.location.href
      });
    }
  }

  handleMessage(message) {
    if (message.action === 'scanPage') {
      this.scanExistingMessages();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PrivacyGuardian());
} else {
  new PrivacyGuardian();
}

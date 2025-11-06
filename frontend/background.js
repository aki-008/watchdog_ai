// background.js - Firefox Compatible Version

const API_CONFIG = {
  baseUrl: 'http://127.0.0.1:8000',
  endpoints: {
    detectPII: '/detect_pii',
    anonymize: '/anonymize',
    smartAnonymize: '/smart_anonymize'
  },
  timeout: 15000
};

class BackgroundService {
  constructor() {
    this.init();
  }

  init() {
    // Firefox uses browser.runtime instead of chrome.runtime
    const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

    runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'checkPII') {
        this.checkPII(message.text).then(sendResponse);
        return true;
      } else if (message.action === 'anonymize') {
        this.anonymizeText(message.text).then(sendResponse);
        return true;
      } else if (message.action === 'scanHistory') {
        this.scanHistory(message.messages, message.url).then(sendResponse);
        return true;
      } else if (message.action === 'pingBackend') {
        this.pingBackend().then(sendResponse);
        return true;
      }
    });

    console.log('Privacy Guardian Background Service: Started (Firefox)');
  }

  async pingBackend() {
    try {
      const response = await this.fetchWithTimeout(
        `${API_CONFIG.baseUrl}/`,
        { method: 'GET' },
        3000
      );
      const data = await response.json();
      return { online: true, message: data.message };
    } catch (error) {
      console.error('Backend ping failed:', error);
      return { online: false, error: error.message };
    }
  }

  async checkPII(text) {
    try {
      const response = await this.fetchWithTimeout(
        `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.detectPII}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ text })
        }
      );

      const result = await response.json();
      return {
        hasPII: result.pii_detected || false,
        source: 'backend'
      };
    } catch (error) {
      console.error('PII detection error:', error);
      return this.localPIICheck(text);
    }
  }

  async anonymizeText(text) {
    try {
      const response = await this.fetchWithTimeout(
        `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.smartAnonymize}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        }
      );

      const result = await response.json();
      return {
        anonymized_text: result.anonymized_text || text,
        replacements: result.replacements || [],
        message: result.message
      };
    } catch (error) {
      console.error('Anonymization error:', error);
      return {
        anonymized_text: text,
        replacements: [],
        error: error.message
      };
    }
  }

  async scanHistory(messages, url) {
    try {
      const allFindings = [];
      let totalLeaks = 0;

      for (const msg of messages) {
        try {
          const response = await this.fetchWithTimeout(
            `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.smartAnonymize}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: msg.text })
            }
          );

          const result = await response.json();

          if (result.replacements && result.replacements.length > 0) {
            totalLeaks += result.replacements.length;
            allFindings.push({
              message: msg.text.substring(0, 100) + '...',
              findings: result.replacements
            });
          }
        } catch (err) {
          console.error('Error scanning message:', err);
        }
      }

      const scanResult = {
        timestamp: new Date().toISOString(),
        url,
        totalMessages: messages.length,
        leaksFound: totalLeaks,
        findings: allFindings.flatMap(f => f.findings)
      };

      // Firefox compatible storage
      const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
      await storage.local.set({ lastHistoryScan: scanResult });

      if (totalLeaks > 0) {
        this.showNotification(totalLeaks);
      }

      return { success: true, leaksFound: totalLeaks };
    } catch (error) {
      console.error('History scan error:', error);
      return { success: false, error: error.message };
    }
  }

  localPIICheck(text) {
    const patterns = [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i,
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
      /\b\d{3}-\d{2}-\d{4}\b/,
      /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/
    ];

    const hasPII = patterns.some(pattern => pattern.test(text));

    return {
      hasPII,
      source: 'local_fallback',
      message: 'Backend unavailable, using local detection'
    };
  }

  async fetchWithTimeout(url, options, timeout = API_CONFIG.timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  showNotification(leaksFound) {
    const notifications = typeof browser !== 'undefined' ? browser.notifications : chrome.notifications;
    notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🛡️ Privacy Guardian Alert',
      message: `Found ${leaksFound} potential privacy leak(s) in your chat history. Click to review.`
    });
  }
}

new BackgroundService();

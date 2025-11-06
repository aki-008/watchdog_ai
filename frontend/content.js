console.log("✅ Content script loaded successfully");

// Flexible selectors for different chat UIs
const CHAT_INPUT_SELECTORS = [
    'textarea#prompt-textarea',
    'textarea[aria-label="Message"]',
    'textarea[placeholder*="Send a message"]',
    'textarea'
];
const SUBMIT_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    'button'
];

function queryFirst(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function initializePromptInterceptor() {
    const observer = new MutationObserver(() => {
        const submitButton = queryFirst(SUBMIT_BUTTON_SELECTORS);
        const chatInput = queryFirst(CHAT_INPUT_SELECTORS);

        if (submitButton && chatInput && !submitButton.dataset.monitorAttached) {
            chrome.storage.local.get(['isMonitoringEnabled'], (res) => {
                const enabled = res['isMonitoringEnabled'] !== false; // default true
                if (!enabled) {
                    console.log('AI Monitor: disabled via popup storage.');
                    return;
                }

                submitButton.addEventListener('click', handlePromptSubmission, true);
                chatInput.addEventListener('keydown', handleInputKeyDown, true);
                submitButton.dataset.monitorAttached = 'true';
                console.log("AI Monitor: Listener attached.");
                observer.disconnect();
            });
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

async function handlePromptSubmission(event) {
    const chatInput = queryFirst(CHAT_INPUT_SELECTORS);
    const submitButton = event.currentTarget;
    const userPrompt = chatInput ? chatInput.value.trim() : '';
    if (!userPrompt) return;

    // Prevent duplicate processing
    if (submitButton.__aiMonitorProcessing) return;
    submitButton.__aiMonitorProcessing = true;

    event.stopPropagation();
    event.preventDefault();

    console.log("🤖 AI Monitor: Captured prompt:", userPrompt);

    try {
        // Send to background (which calls FastAPI backend)
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'monitorPrompt', prompt: userPrompt }, (res) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(res || {});
            });
        });

        console.log("📬 AI Monitor: Response from backend:", response);

        if (response && response.isSensitive) {
            injectWarningMessage(response.message || 'Sensitive content detected — blocked by AI!');
            submitButton.__aiMonitorProcessing = false;
            return;
        } else {
            removeWarningMessage();
            // Let the original click go through
            setTimeout(() => {
                submitButton.removeEventListener('click', handlePromptSubmission, true);
                submitButton.click();
                requestAnimationFrame(() => {
                    submitButton.addEventListener('click', handlePromptSubmission, true);
                    submitButton.__aiMonitorProcessing = false;
                });
            }, 0);
        }
    } catch (error) {
        console.error("❌ AI Monitor: Background communication failed, allowing prompt.", error);
        // Fallback: allow submission
        setTimeout(() => {
            submitButton.removeEventListener('click', handlePromptSubmission, true);
            submitButton.click();
            requestAnimationFrame(() => {
                submitButton.addEventListener('click', handlePromptSubmission, true);
                submitButton.__aiMonitorProcessing = false;
            });
        }, 0);
    }
}

function handleInputKeyDown(event) {
    const chatInput = queryFirst(CHAT_INPUT_SELECTORS);
    if (event.key === 'Enter' && !event.shiftKey) {
        const submitButton = queryFirst(SUBMIT_BUTTON_SELECTORS);
        if (submitButton) {
            submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    }
}

function injectWarningMessage(message) {
    let warningDiv = document.getElementById('ai-monitor-warning');
    if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.id = 'ai-monitor-warning';
        warningDiv.style.cssText = `
            position: fixed;
            bottom: 60px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            background-color: #f44336;
            color: white;
            border-radius: 5px;
            z-index: 99999;
            font-weight: bold;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(warningDiv);
    }
    warningDiv.textContent = `🚨 WARNING: ${message}`;
    warningDiv.style.opacity = 1;
}

function removeWarningMessage() {
    const warningDiv = document.getElementById('ai-monitor-warning');
    if (warningDiv) {
        warningDiv.style.opacity = 0;
        setTimeout(() => warningDiv.remove(), 300);
    }
}

initializePromptInterceptor();

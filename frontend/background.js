console.log("🟢 Background service worker loaded.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📩 Message received in background.js:", message);

    if (message.action === "monitorPrompt") {
        console.log("🔍 Checking prompt via backend:", message.prompt);

        fetch("http://localhost:8000/send_data/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: message.prompt })
        })
            .then(response => response.json())
            .then(data => {
                console.log("✅ Backend response:", data);
                const isSensitive = data.sensitive === true;
                sendResponse({
                    isSensitive,
                    message: isSensitive
                        ? "⚠️ Sensitive content detected — blocked by AI!"
                        : "✅ Safe to send (AI-approved).",
                    labels: data.labels
                });
            })
            .catch(error => {
                console.error("❌ Error calling backend:", error);
                sendResponse({
                    isSensitive: false,
                    message: "Error contacting backend.",
                });
            });

        return true; // keep channel open
    }

    return true;
});

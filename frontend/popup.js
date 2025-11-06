// Key used for storage across all scripts
const MONITOR_STATUS_KEY = 'isMonitoringEnabled';

// DOM Elements
const toggleSwitch = document.getElementById('toggleSwitch');
const statusText = document.getElementById('status-text');
const statusLight = document.getElementById('status-light');


/**
 * 1. Initialize the UI based on the current stored status.
 */
function initializeUI() {
    // Read the current status from local storage
    chrome.storage.local.get([MONITOR_STATUS_KEY], (result) => {
        const isEnabled = result[MONITOR_STATUS_KEY] !== false; // Default to true if not set
        
        toggleSwitch.checked = isEnabled;
        updateStatusDisplay(isEnabled);
    });
}


/**
 * 2. Handle the toggle switch change event.
 */
function handleToggleChange() {
    const isEnabled = toggleSwitch.checked;
    
    // Save the new status to local storage
    chrome.storage.local.set({ [MONITOR_STATUS_KEY]: isEnabled }, () => {
        console.log(`Monitoring status set to: ${isEnabled}`);
        updateStatusDisplay(isEnabled);

        // Optionally, send a message to all content scripts to update immediately
        // (though they usually rely on storage.onChanged for this)
        // chrome.tabs.query({}, (tabs) => {
        //     tabs.forEach(tab => {
        //         chrome.tabs.sendMessage(tab.id, { action: 'updateStatus', isEnabled: isEnabled });
        //     });
        // });
    });
}


/**
 * 3. Update the text and light indicator in the popup.
 */
function updateStatusDisplay(isEnabled) {
    if (isEnabled) {
        statusText.textContent = 'Status: ON (Active)';
        statusLight.style.backgroundColor = '#4CAF50'; // Green
    } else {
        statusText.textContent = 'Status: OFF (Disabled)';
        statusLight.style.backgroundColor = '#FF9800'; // Orange
    }
}


// --- Execution ---
document.addEventListener('DOMContentLoaded', initializeUI);
toggleSwitch.addEventListener('change', handleToggleChange);
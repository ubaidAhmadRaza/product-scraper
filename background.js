// background.js - Service worker

chrome.runtime.onInstalled.addListener(() => {
    console.log('Product Extractor Pro installed');
});

// Relay messages from content script to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'log' || message.action === 'statusUpdate') {
        // Broadcast to all extension pages (popup)
        chrome.runtime.sendMessage(message).catch(() => {
            // Popup not open, ignore
        });
    }
    return true;
});
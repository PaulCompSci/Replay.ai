// Service Worker for Replay.ai
// Collects and manages all recorded events

let allEvents = [];
let currentRecording = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RECORDING_EVENT') {
    // Store the event
    const event = {
      ...message.event,
      tabId: sender.tab?.id,
      timestamp: Date.now(),
      pageUrl: message.event.url || sender.tab?.url
    };
    
    allEvents.push(event);
    
    // If there's an active recording, add to that recording's events
    if (currentRecording) {
      currentRecording.events.push(event);
    }
    
    // Log to service worker console
    console.log(`[Replay.ai] Event recorded:`, event);
    
    sendResponse({ success: true });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'START_RECORDING') {
    currentRecording = {
      id: Date.now().toString(),
      startTime: Date.now(),
      url: message.url || sender.tab?.url,
      tabId: sender.tab?.id,
      events: []
    };
    console.log(`[Replay.ai] Recording started:`, currentRecording);
    sendResponse({ success: true, recordingId: currentRecording.id });
    return true;
  }
  
  if (message.type === 'STOP_RECORDING') {
    if (currentRecording) {
      currentRecording.endTime = Date.now();
      currentRecording.duration = currentRecording.endTime - currentRecording.startTime;
      console.log(`[Replay.ai] Recording stopped:`, currentRecording);
      currentRecording = null;
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'GET_ALL_EVENTS') {
    sendResponse({ events: allEvents, recording: currentRecording });
    return true;
  }
  
  if (message.type === 'CLEAR_EVENTS') {
    allEvents = [];
    currentRecording = null;
    console.log(`[Replay.ai] All events cleared`);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'PRINT_ALL_EVENTS') {
    printAllEvents();
    sendResponse({ success: true });
    return true;
  }
});

// Print all events in a formatted way
function printAllEvents() {
  console.group('🎬 Replay.ai - All Recorded Events');
  console.log(`Total Events: ${allEvents.length}`);
  console.log(`Current Recording: ${currentRecording ? 'Active' : 'None'}`);
  console.log('');
  
  if (allEvents.length === 0) {
    console.log('No events recorded yet.');
    console.groupEnd();
    return;
  }
  
  // Group events by URL
  const eventsByUrl = {};
  allEvents.forEach(event => {
    const url = event.url || event.pageUrl || 'unknown';
    if (!eventsByUrl[url]) {
      eventsByUrl[url] = [];
    }
    eventsByUrl[url].push(event);
  });
  
  // Print events grouped by URL
  Object.entries(eventsByUrl).forEach(([url, events]) => {
    console.group(`📄 ${url} (${events.length} events)`);
    events.forEach((event, index) => {
      console.log(`[${index + 1}]`, event);
    });
    console.groupEnd();
  });
  
  // Print summary
  console.log('');
  console.log('📊 Summary:');
  const actionCounts = {};
  allEvents.forEach(event => {
    actionCounts[event.action] = (actionCounts[event.action] || 0) + 1;
  });
  Object.entries(actionCounts).forEach(([action, count]) => {
    console.log(`  ${action}: ${count}`);
  });
  
  // Print as JSON
  console.log('');
  console.log('📋 JSON Export:');
  console.log(JSON.stringify(allEvents, null, 2));
  
  console.groupEnd();
}

// Listen for extension icon click to print events
chrome.action.onClicked.addListener((tab) => {
  printAllEvents();
});

// Command to print events (Ctrl+Shift+P or Cmd+Shift+P)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'print-events') {
    printAllEvents();
  }
});

// Listen for tab updates to track navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && currentRecording) {
    console.log(`[Replay.ai] Page navigated: ${tab.url}`);
  }
});

// Initialize
console.log('[Replay.ai] Service Worker initialized');


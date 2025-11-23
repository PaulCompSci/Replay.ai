// Popup script for Replay.ai
document.addEventListener('DOMContentLoaded', () => {
  const printBtn = document.getElementById('printBtn');
  const clearBtn = document.getElementById('clearBtn');
  
  printBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PRINT_ALL_EVENTS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError);
        return;
      }
      // Close popup after printing
      window.close();
    });
  });
  
  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all recorded events?')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError);
          return;
        }
        alert('All events cleared!');
        window.close();
      });
    }
  });
});


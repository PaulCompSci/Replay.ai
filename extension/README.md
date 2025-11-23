# Replay.ai Chrome Extension

A lightweight Chrome extension that records user interactions and DOM changes on webpages, outputting events in JSON format to the console.

## Features

- 🎯 **Single-click recording** with floating button
- 🖱️ **Event tracking**: clicks, inputs, scrolls, popups
- 🎨 **Multiple selector strategies** for reliable element identification
- 🚀 **Optimized performance** with modern browser APIs
- 📊 **JSON console output** for easy integration

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top-right corner)
3. Click "Load unpacked"
4. Select the `extension` folder

## Usage

1. Navigate to any webpage
2. Click the **⏺ REC** button (top-right corner) to start recording
3. Interact with the page (click, type, scroll)
4. Open the browser console (F12) to see events
5. Click **⏸ STOP** to stop recording

## Event Format

Events are logged to the console in this JSON format:

```json
{
  "t": 1023,
  "action": "click",
  "text": "Login",
  "selectors": [
    "#login-btn",
    "button:has-text('Login')",
    "button.btn-primary",
    "div.auth > button:nth-child(1)"
  ],
  "domPath": "body > div.container > button.btn-primary:nth-child(1)",
  "url": "https://example.com/login"
}
```

### Supported Actions

- `click` - User clicks on an element
- `input` - User types in input/textarea fields
- `scroll` - User scrolls the page
- `popup` - Modal/dialog appears on page

## Technical Improvements

### Modern Browser APIs

1. **AbortController** - Single cleanup for all event listeners (no manual tracking needed)
2. **CSS.escape()** - Proper escaping of CSS selectors
3. **requestAnimationFrame** - Efficient scroll throttling
4. **Passive event listeners** - Better scroll performance

### Architecture

- **Class-based design** - Encapsulated state and methods
- **Delegated event handling** - Single listener for each event type
- **Simplified mutation observer** - Focused on structural changes only
- **Smart selector generation** - Prioritizes stable selectors (ID > data attributes > classes)

### Performance Optimizations

- Reduced redundant DOM traversals
- Limited selector depth to avoid performance issues
- Filtered out unstable CSS classes (hover, active, focus)
- Throttled scroll events with requestAnimationFrame

## Code Comparison

### Before (~430 lines)

- Multiple event listener arrays to manage
- Manual cleanup of each listener
- Redundant selector generation logic
- Verbose DOM traversal

### After (~230 lines)

- Single AbortController for cleanup
- Reusable class-based architecture
- Simplified selector logic with modern APIs
- 46% less code with same functionality

## Browser Compatibility

- Chrome 88+ (Manifest V3)
- Edge 88+
- Brave 1.20+

## Development

### File Structure

```
extension/
├── manifest.json     # Extension configuration
├── content.js        # Main recorder logic (class-based)
├── styles.css        # Floating button styles
├── popup.html        # Extension popup (optional)
└── README.md         # This file
```

### Future Enhancements

- Export recordings to JSON/HAR files
- Visual diff detection
- Screenshot capture
- Replay functionality
- Network request tracking
- Chrome DevTools integration

## License

MIT

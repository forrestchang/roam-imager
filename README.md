# Imager - Image Gallery for Roam Research

Imager helps you manage and browse all images in your Roam Research graph in a beautiful gallery view.

## Features

- **Image Discovery**: Automatically finds all images in your graph including:
  - Markdown images `![alt](url)`
  - Uploaded images `{{[[upload]]: url}}`
  - Direct image URLs (png, jpg, jpeg, gif, webp, svg)
  
- **Gallery View**: Browse images in a responsive grid layout
- **Pagination**: Efficiently handles large image collections (20 images per page)
- **Quick Navigation**: Click any image to jump to its source block
- **Image Information**: See which page contains each image and when it was created
- **Multiple Access Methods**:
  - Command palette: Search for "Open Image Gallery"
  - Topbar button: Click the media icon in the top menu

## Installation

1. Copy the extension URL
2. In Roam Research, go to Settings → Extensions
3. Click "Add Extension"
4. Paste the URL and click "Add"

## Usage

### Opening the Gallery

**Option 1: Command Palette**
- Press `Cmd/Ctrl + P` to open command palette
- Type "Open Image Gallery"
- Press Enter

**Option 2: Topbar Button**
- Look for the media icon in the top menu bar
- Click it to open the gallery

### Navigating Images

- Browse through your images in the grid view
- Hover over an image to see:
  - The page it's located on
  - When it was created
- Click an image to navigate to its source block
- Use pagination controls at the bottom for large collections

### Keyboard Shortcuts

- `Esc` - Close the gallery
- Click outside the popup to close

## Performance

The extension is optimized for graphs with many images:
- Displays 20 images per page
- Lazy loading for better performance
- Efficient querying to minimize load time

## Troubleshooting

If images don't appear:
- Make sure the image URLs are accessible
- Check that images are properly formatted in Roam
- Try refreshing the page and reopening the gallery

## Support

For issues or feature requests, please contact the developer or submit an issue on GitHub.
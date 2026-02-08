# ScriptMate App Icon Design Guide

## Icon Concept
ScriptMate combines **acting/scripts** with **AI/technology** to help actors learn their lines. The icon should convey professionalism, innovation, and creativity.

## Recommended Design Direction

### Primary Concept: Script + Microphone Hybrid
A stylized **theater script page** combined with a **microphone** or **soundwave** element, using a modern flat design style.

### Color Palette
- **Primary:** Purple (#6366f1) - Innovation, creativity
- **Secondary:** Indigo (#4f46e5) - Depth, technology
- **Accent:** Gold/Amber (#f59e0b) - Premium, stage lights
- **Background:** Dark (#0a0a0f) - Professional, cinematic

### Design Elements
1. **Script/Page Icon** - Represents the core script learning function
2. **Microphone/Soundwave** - Represents AI voice reading
3. **Circular shape** - Works well on both iOS and Android
4. **Minimal text** - Icon should work without text at small sizes

## Icon Specifications

### iOS Requirements
| Size | Pixels | Usage |
|------|--------|-------|
| 1x | 1024x1024 | App Store |
| 3x | 180x180 | iPhone |
| 2x | 120x120 | iPhone (older) |
| 2x | 152x152 | iPad |
| 2x | 167x167 | iPad Pro |

### Android Requirements
| Size | Pixels | Usage |
|------|--------|-------|
| xxxhdpi | 192x192 | Launcher |
| xxhdpi | 144x144 | Launcher |
| xhdpi | 96x96 | Launcher |
| hdpi | 72x72 | Launcher |
| mdpi | 48x48 | Launcher |
| Play Store | 512x512 | Store Listing |

## Reference Images (from Pexels - Free to Use)

### Script/Acting References:
- https://images.pexels.com/photos/6896316/pexels-photo-6896316.jpeg
- https://images.pexels.com/photos/6896191/pexels-photo-6896191.jpeg
- https://images.pexels.com/photos/6895792/pexels-photo-6895792.jpeg

### Microphone/Technology References:
- https://images.pexels.com/photos/352505/pexels-photo-352505.jpeg
- https://images.pexels.com/photos/801459/pexels-photo-801459.jpeg
- https://images.pexels.com/photos/194985/pexels-photo-194985.jpeg

## Suggested Icon Mockups

### Option A: Script with Soundwaves
```
┌─────────────────┐
│    ╭──────╮     │
│    │ ≡≡≡≡ │)))) │
│    │ ≡≡≡≡ │     │
│    │ ≡≡≡  │     │
│    ╰──────╯     │
└─────────────────┘
```
- Script document with soundwave lines emanating
- Purple gradient background
- Clean, minimal

### Option B: Microphone with Script
```
┌─────────────────┐
│       🎤        │
│      ────       │
│    ┌─────┐      │
│    │▔▔▔▔▔│      │
│    │▔▔▔▔ │      │
│    └─────┘      │
└─────────────────┘
```
- Microphone above stylized script lines
- Dark background with purple accent
- Tech-forward

### Option C: Combined "SM" Monogram
```
┌─────────────────┐
│                 │
│    ╭S─M╮        │
│    │   │        │
│    ╰───╯        │
│                 │
└─────────────────┘
```
- Stylized "SM" letters
- Script page shape incorporated
- Modern, minimal

## Design Tools Recommended
- **Figma** - Icon design and export
- **Canva** - Quick mockups
- **Adobe Illustrator** - Vector graphics
- **IconKitchen** - Android adaptive icons
- **MakeAppIcon** - Generate all sizes

## Icon Generation Command
Once you have your 1024x1024 master icon, use these tools to generate all sizes:
```bash
# Using ImageMagick
convert icon-1024.png -resize 512x512 icon-512.png
convert icon-1024.png -resize 192x192 icon-192.png
convert icon-1024.png -resize 180x180 icon-180.png
convert icon-1024.png -resize 152x152 icon-152.png
convert icon-1024.png -resize 120x120 icon-120.png
convert icon-1024.png -resize 96x96 icon-96.png
convert icon-1024.png -resize 72x72 icon-72.png
convert icon-1024.png -resize 48x48 icon-48.png
```

## Placement
After creating icons, place them in:
- `/app/frontend/assets/images/icon.png` (1024x1024)
- `/app/frontend/assets/images/adaptive-icon.png` (1024x1024, for Android)
- `/app/frontend/assets/images/favicon.png` (48x48, for web)
- `/app/frontend/assets/images/splash-icon.png` (200x200, for splash)

## Quick Online Icon Generators
1. **App Icon Generator** - https://appicon.co
2. **Icon Kitchen** - https://icon.kitchen
3. **EasyAppIcon** - https://easyappicon.com

---

*Pro Tip: Test your icon at multiple sizes before finalizing. It should be recognizable even as a tiny 48x48 pixel image.*

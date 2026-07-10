# Starlight Arena Prototype

A playable third-person Three.js training arena prototype built with Vite and TypeScript.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the local address printed by Vite, usually `http://localhost:5173`.

## Build

```bash
npm run build
```

## Controls

Desktop:

- Click the 3D canvas to lock the pointer. Press `Esc` to release it.
- `W`, `A`, `S`, `D`: move relative to the character facing direction.
- Mouse: turn and look up/down.
- Left mouse: fire.
- Right mouse or `Shift`: aim.
- `R`: reload.
- Hold `V`: front-check camera.
- `C`: toggle first-person and third-person cameras.

Mobile input is enabled at runtime for mobile user agents or compact touch-capable devices. It provides a left joystick, right look area, fire button, and front-check button.

## Assets

- `public/images/victory-arena.png` and `public/images/defeat-arena.png` are original generated result-screen artwork.
- Existing third-party asset attribution and licenses are retained beside their assets under `public/assets/`.
- Place a VRM avatar at `public/avatars/avatar.vrm` to replace the runtime placeholder.

## Publish to GitHub

The repository is ready for Git. After creating an empty GitHub repository, run:

```bash
git add .
git commit -m "Initial Starlight Arena prototype"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

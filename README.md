# CourtVision — Estadísticas de Básquet (Web + PWA + Android APK)

Plataforma híbrida **100% gratuita (S/ 0)** para visualizar estadísticas de básquet profesional (NBA 2026-27) y preparada desde la base de datos para soportar **ligas locales y torneos amateurs**.

## Stack 100% Gratis

- **Frontend Web + PWA:** React + Vite + TypeScript + Tailwind CSS + `vite-plugin-pwa`
- **Base de Datos y API:** Supabase Free (`sports-stats`), Postgres 17 + Row Level Security + Realtime
- **Ingesta automática:** Python 3 (stdlib pura, sin `pip`) + GitHub Actions cada 6 horas
- **Hosting Web:** Cloudflare Pages (ancho de banda ilimitado gratis y apto para uso comercial)
- **App Móvil:**
  - **PWA:** Instalable directo desde Chrome (Android) o Safari (iOS)
  - **Android APK:** Empaquetado con **Capacitor** (en local o mediante GitHub Actions)

## Desarrollo Local

```bash
npm install
npm run dev
```

Las variables públicas están configuradas en `.env.local` (ignorado por Git):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Sincronización Automática (GitHub Actions)

1. Sube este repositorio a **GitHub** (público para minutos ilimitados, o privado hasta 2,000 min/mes).
2. En **Settings → Secrets and variables → Actions**, agrega estos **Secrets**:
   - `SUPABASE_URL`: URL de tu proyecto Supabase (`sports-stats`)
   - `SUPABASE_SERVICE_ROLE_KEY`: tu clave secreta `service_role` (solo para el script en el servidor, nunca en el frontend)
3. El workflow `.github/workflows/sync-nba.yml` actualizará marcadores, box scores y posiciones cada 6 horas, manteniendo también tu proyecto de Supabase activo sin pausas por inactividad.

## Despliegue Gratis en Cloudflare Pages

1. Conecta tu repo de GitHub en **Cloudflare Pages**.
2. Configura:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - **Environment variables:** `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`

## Generar App Android (.apk) Gratis con Capacitor

Opción A (en la nube con GitHub Actions):
- Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en **Settings → Variables → Actions**.
- Ejecuta el workflow **Build Android APK (Capacitor)** y descarga `app-debug.apk`.

Opción B (en tu PC Windows):
```bash
npm install @capacitor/android@^7.2.0
npx cap add android
npm run cap:sync
cd android && ./gradlew assembleDebug
```

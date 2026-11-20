# Reglas del Proyecto CourtVision Stats (`stats-sports`)

Estas reglas aplican a **todo el repositorio** y deben cumplirse en cada intervención:

## 1. Publicación obligatoria en Git (Regla Global del Proyecto)
- **Cada mejora, refactorización, corrección o nueva funcionalidad** implementada en este proyecto **DEBE quedar subida a Git (`origin/main`)** antes de entregar la respuesta final al usuario.
- Flujo obligatorio al terminar los cambios:
  1. Verificar que `npm run build` (`tsc -b && vite build`) y las comprobaciones correspondientes pasen con código `0`.
  2. Revisar `git status` para asegurarse de **no** incluir archivos secretos ignorados (`.env`, `.env.local`, claves privadas).
  3. Ejecutar `git add` de los archivos modificados/creados, `git commit -m "<tipo>: <resumen claro en español>"` y `git push origin main`. **Todos los mensajes de commit deben redactarse obligatoriamente en español** (ej.: `feat: resumen en español`, `fix: corrección en español`).
  4. Reportar el hash del commit subido (`git rev-parse --short HEAD`) al usuario.

## 2. Entorno de Producción y Pagos Reales
- No dejar datos de prueba, códigos demo hardcodeados (`testMode`), bypasses de suscripción ni números placeholder en código fuente ni en la base de datos.
- Mantener configurados `.env.local` (ignorado por Git) y `.env.example` (plantilla versionada) sincronizados con las variables `VITE_*` usadas en la aplicación.

## 3. Aislamiento de Supabase
- Este proyecto trabaja **exclusivamente** contra el proyecto `sports-stats` (`dowxayyvtghtjkctasfn`) a través del servidor MCP `supabase_mcp`.
- Nunca consultar ni modificar otro servidor MCP de Supabase ajeno al proyecto.

## 4. Control de Versiones y Notas de Lanzamiento (Google Play Store)
- **Última versión `.aab` generada:** `versionCode: 8` | `versionName: 1.0.6` (2026-11-20).
- **Regla obligatoria en cada actualización destinada a Play Store (`.aab`):**
  1. Incrementar correlativamente a partir de la última versión registrada (`versionCode` `+ 1` y `versionName` correlativo, p. ej. `6` y `1.0.4`, salvo cambio mayor/menor explícito).
  2. Actualizar la línea **Última versión `.aab` generada** en este archivo `GEMINI.md` con el nuevo `versionCode`, `versionName` y fecha antes de hacer commit.
  3. Incluir obligatoriamente al final de la respuesta al usuario los valores exactos para el workflow (`version_code` y `version_name`) y la **Nota de versión (`es-ES`)** lista para pegar en Google Play Console.

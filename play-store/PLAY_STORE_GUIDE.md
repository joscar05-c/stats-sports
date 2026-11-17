# Guía Paso a Paso: Publicación en Google Play Console (CourtVision Stats)

Esta guía cubre todo el proceso desde generar tu firma criptográfica hasta completar las fases de **Pruebas Internas → Pruebas Cerradas → Pruebas Abiertas → Producción**.

---

## Paso 1: Generar tu Upload Keystore (`.jks`) — SOLO UNA VEZ
> **NUNCA** subas el archivo `.jks` ni tus contraseñas a Git. Guárdalo en un lugar seguro con respaldo (ej. tu nube privada o gestor de contraseñas), porque si lo pierdes tendrás que pedir un reset de clave en Play Console.

En tu carpeta segura fuera del repo (ej. `C:\Users\UTIC\android-keys`), ejecuta en PowerShell (ya tienes `keytool` de JDK 17 instalado):

```powershell
mkdir C:\Users\UTIC\android-keys -Force
keytool -genkey -v -keystore C:\Users\UTIC\android-keys\courtvision-upload.jks `
  -keyalg RSA -keysize 2048 -validity 10000 -alias courtvision
```

Te pedirá una contraseña de keystore, contraseña de alias, tu nombre y país (`PE` u otro).

---

## Paso 2: Configurar los Secrets en GitHub para generar `.aab` firmados
Convierte tu `.jks` a Base64 en PowerShell y cópialo al portapapeles:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\UTIC\android-keys\courtvision-upload.jks")) | Set-Clipboard
```

Luego ve a tu repositorio en GitHub → **Settings → Secrets and variables → Actions → Environments (`VARIABLES DE ENTORNO`)** o **Repository secrets** y agrega:

| Secret | Valor |
| :--- | :--- |
| `ANDROID_KEYSTORE_BASE64` | El texto Base64 copiado al portapapeles |
| `ANDROID_KEYSTORE_PASSWORD` | La contraseña que diste al keystore |
| `ANDROID_KEY_ALIAS` | `courtvision` |
| `ANDROID_KEY_PASSWORD` | La contraseña del alias (suele ser la misma) |

> **Nota sobre compilación local en PC:** Si algún día quieres firmar desde tu PC sin CI, crea el archivo `android/keystore.properties` (ignorado por Git) con `storeFile=...`, `storePassword=...`, `keyAlias=courtvision`, `keyPassword=...` y corre `cd android && .\gradlew bundleRelease`.

---

## Paso 3: Generar tu primer `.aab` firmado
1. En GitHub → pestaña **Actions** → selecciona **Build Android AAB (Google Play Store)**.
2. Presiona **Run workflow** con `version_code = 1` y `version_name = 1.0.0`.
3. Al terminar, descarga el artifact `courtvision-stats-v1.0.0-build1-aab`, descomprímelo y obtendrás:
   - `app-release.aab` (el archivo oficial que exige Google Play Console)
   - `app-release.apk` (para instalar directo en tu celular Android y probarlo antes de subir).

*(Nota: En el código subido, el `versionCode` debe ser **estrictamente mayor** cada vez que subas una nueva versión a Play Console: `1`, `2`, `3`, etc.)*

---

## Paso 4: Preparar tu cuenta y la ficha en Google Play Console
1. Crea la aplicación en Play Console con **Nombre:** `CourtVision Stats`, **Tipo:** Aplicación, **Gratuita**.
2. Completa todas las secciones del panel izquierdo (**Configurar tu app**):
   - **Política de privacidad:** `https://TU-DOMINIO/privacidad.html`
   - **Acceso a la aplicación:** Sin restricciones (y/o credenciales demo opcionales si quieres que prueben login).
   - **Anuncios:** No contiene anuncios.
   - **Clasificación de contenido (IARC):** Deporte/Entretenimiento informativo, sin apuestas con dinero real.
   - **Público objetivo:** 18+ (No diseñada para niños).
   - **Seguridad de los datos (Data Safety):** Copia las respuestas exactas de `play-store/STORE_LISTING.md` e ingresa `https://TU-DOMINIO/eliminar-cuenta.html` como URL de eliminación de cuenta.
   - **Ficha de Play Store principal:** Sube `play-store/assets/icon-512.png`, `play-store/assets/feature-graphic-1024x500.png` y al menos 2 capturas de teléfono tomadas de la app en tu Android.

---

## Paso 5: Flujo de lanzamientos (Pruebas → Producción)

### 1. Pruebas internas (Internal Testing) — *Recomendado primero (15 min)*
- Ve a **Pruebas → Pruebas internas → Crear versión**.
- Sube tu `app-release.aab` (`versionCode: 1`).
- En la pestaña **Testers**, crea una lista con tu correo Gmail y el de 2–3 dispositivos propios.
- Comparte el enlace de invitación, instálala desde Play Store en tu Android y valida:
  - Carga de ligas NBA + 18 ligas de fútbol.
  - Cambio de pestañas, tablas multi-grupo, catálogo de ligas (`Explorar`).
  - Registro / inicio de sesión con correo y prueba de *Eliminar mi cuenta* con una cuenta de prueba.

### 2. Pruebas cerradas (Closed Testing)
- En Play Console ve a **Pruebas → Pruebas cerradas → Administrar pista**.
- Sube el `.aab` (si cambiaste algo tras la prueba interna, incrementa `versionCode` a `2`) y envíalo a revisión de Google.
- **Testers y requisito de cuentas personales:**
  - Si tu cuenta de desarrollador Play Console es **personal nueva (creada después de nov. 2023)**, Google exige tener **al menos 12 testers inscritos participando de forma continua durante 14 días seguidos** antes de habilitar el botón *"Solicitar acceso a producción"*.
  - Si tu cuenta es antigua o de **Organización (DUNS)**, las pruebas cerradas son opcionales / sin mínimo de 12×14 días y puedes pasar a Producción en cuanto aprueben tu versión.
- Usa las listas de correos Gmail de tus testers (deben abrir el enlace opt-in desde su Android con esa misma cuenta Gmail de Play Store e instalarla).

### 3. Pruebas abiertas (Open Testing) — *Opcional*
- Una vez aprobada la pista cerrada, puedes promover la misma compilación a **Pruebas abiertas** (botón **Promover versión → Pruebas abiertas**) para que cualquier usuario la encuentre en Play Store como versión anticipada y recoger feedback real sin afectar tu calificación pública aún.

### 4. Producción
- Completa el cuestionario final de producción (si aplica por pruebas cerradas) y promueve la versión validada a **Producción** (`Promover versión → Producción`).
- Google revisa entre 1 y 7 días y publica `CourtVision Stats` en Google Play Store.

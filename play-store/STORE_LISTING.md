# Ficha de Google Play Console — CourtVision Stats

Copia y pega estos valores al crear tu aplicación en **Google Play Console**.

---

## 1. Detalles principales de la aplicación
- **Nombre de la app (máx. 30 caracteres):**
  `CourtVision Stats` *(17 caracteres)*
- **Package ID:**
  `com.courtvision.stats`
- **Idioma predeterminado:**
  `Español (Latinoamérica) – es-419` (o `Español (España) – es-ES`)
- **App o juego:** `Aplicación`
- **Gratuita o de pago:** `Gratuita`
- **Categoría en Play Store:** `Deportes`
- **Etiquetas (hasta 5):** `Deportes`, `Fútbol`, `Baloncesto`, `Estadísticas`, `Marcadores en vivo`

---

## 2. Descripción corta (máx. 80 caracteres)
`Marcadores, tablas, líderes y comparativas de Fútbol y NBA en tiempo real.`
*(75 caracteres — sin palabras de riesgo como "apuestas" o "casino".)*

---

## 3. Descripción completa (máx. 4000 caracteres)
```text
CourtVision Stats es tu centro de análisis estadístico y resultados en vivo para Fútbol y NBA en una interfaz rápida, clara y enfocada en datos reales.

COMPETICIONES INCLUIDAS (19 LIGAS)
• Copas Internacionales: CONMEBOL Libertadores, CONMEBOL Sudamericana y UEFA Champions League.
• Sudamérica (10 ligas nacionales): Argentina, Brasil, Chile, Colombia, Ecuador, Paraguay, Perú, Uruguay, Venezuela y Bolivia.
• Europa: Premier League, LaLiga, Serie A, Bundesliga y Ligue 1.
• Baloncesto: NBA completa (Conferencia Este y Oeste).

FUNCIONES PRINCIPALES
• Marcadores y calendario por fecha: resultados en directo, parciales por cuarto o tiempo, eventos clave del partido y horarios locales.
• Tablas de posiciones actualizadas: clasificación general, por zonas/grupos (Libertadores, Sudamericana, ligas nacionales) y zonas de torneos internacionales.
• Líderes estadísticos: rankings de goleadores, asistencias, puntos por partido (PPG), rebotes, triples y eficiencia por equipo y jugador.
• Comparador cabeza a cabeza (H2H): compara cara a cara el rendimiento de dos jugadores o dos equipos con sus promedios de temporada.
• Explorador y ficha detallada: perfiles de plantilla, promedios locales y de visita, historial reciente partido a partido y análisis porcentual de tendencias.
• Directorio organizado y favoritas: busca al instante cualquier país o torneo y fija tus ligas favoritas para acceso directo.

TRANSPARENCIA E INFORMACIÓN
CourtVision Stats ofrece métricas e información estadística con fines exclusivamente informativos y de análisis deportivo. No es una casa de apuestas ni permite realizar transacciones o apuestas con dinero real.
```

---

## 4. Recursos gráficos obligatorios (ya generados)
- **Ícono de la aplicación (512 × 512 px, PNG):**
  [play-store/assets/icon-512.png](assets/icon-512.png)
- **Gráfico de funciones / Feature Graphic (1024 × 500 px, PNG):**
  [play-store/assets/feature-graphic-1024x500.png](assets/feature-graphic-1024x500.png)
- **Capturas de teléfono (mínimo 2, recomendado 4–6, formato 9:16 o 16:9, lado ≥ 320 px):**
  Al instalar el `app-release.apk` / pista de Pruebas Internas en tu celular, toma 4 capturas limpias (Partidos en vivo, Catálogo de Ligas, Tabla de Posiciones multi-grupo y Comparador H2H).

---

## 5. URLs obligatorias (sirviendo desde tu dominio web desplegado)
> Reemplaza `https://TU-DOMINIO` por la URL real donde publiques el build web (Vercel/Netlify/tu dominio). Las 3 páginas ya están en `public/` y se copian automáticamente a `dist/`.

- **Política de privacidad:** `https://TU-DOMINIO/privacidad.html`
- **Términos de uso (sitio web):** `https://TU-DOMINIO/terminos.html`
- **URL de eliminación de cuenta (Data Safety):** `https://TU-DOMINIO/eliminar-cuenta.html`

---

## 6. Respuestas exactas para Declaraciones de Play Console

### A) Seguridad de los datos (Data Safety)
1. **¿Tu app recopila o comparte alguno de los tipos de datos de usuario requeridos?**
   - **Sí** (solo si el usuario decide crear cuenta opcional para sincronización).
2. **¿Todos los datos recopilados están encriptados en tránsito?**
   - **Sí** (todo tráfico a Supabase Auth y REST va sobre HTTPS/TLS).
3. **¿Ofreces una forma para que los usuarios soliciten la eliminación de sus datos?**
   - **Sí** → URL: `https://TU-DOMINIO/eliminar-cuenta.html` (y botón nativo dentro de la app en *Cuenta → Eliminar mi cuenta*).
4. **Tipos de datos a declarar:**
   - **Información personal → Dirección de correo electrónico:** Recopilado · Obligatorio solo si se registra · Finalidad: *Funcionalidad de la app, Gestión de cuentas* · No se comparte con terceros · Uso opcional (la app funciona sin cuenta).
   - **Información personal → Nombre:** Recopilado · Opcional (al registrarse con correo o Google Web) · Finalidad: *Gestión de cuentas*.
   - **No marcados:** Ubicación, Contactos, Fotos/Videos, Audio, Archivos, Calendario, Actividad financiera dentro de la app, Mensajes, Historial de navegación.

### B) Acceso a la aplicación (App Access)
- **Marca:** *"Toda o parte de mi aplicación está restringida"* → **No** si la revisan como lectura pública, **O SÍ** indicando:
  - Las pantallas principales (Partidos, Líderes, Comparador, Posiciones, Explorar en las 19 ligas) son **100% accesibles sin iniciar sesión**.
  - Si desean probar el perfil de usuario y la eliminación de cuenta, pueden crear una cuenta gratuita con correo directamente en la app o usar la cuenta de prueba que configures para revisores de Google.

### C) Clasificación de contenido (IARC) y Público objetivo
- **Público objetivo:** **18 años o más** (recomendado al incluir líneas estadísticas de referencia deportiva; marca **No** en *"¿Tu app podría atraer a niños?"*).
- **Anuncios:** **No** (tu app no contiene SDKs de anuncios).
- **Compras integradas:** La compilación Android no procesa compras externas dentro de la app; solo sincroniza cuentas existentes multiplataforma y códigos ya emitidos.
- **Apuestas con dinero real:** **No** (no permite apostar ni maneja dinero real).
- **Noticias:** **No**.
- **COVID-19 / Salud / Finanzas / Gobierno:** **No**.

# Road Trip Escocia Offline

PWA local-first para consultar un viaje por etapas, reproducir audioguías y abrir rutas de mapas. El repositorio contiene únicamente la carcasa genérica. El itinerario y los audios se importan en el dispositivo y se guardan en IndexedDB.

## Uso

1. Publicar estos archivos en un origen HTTPS.
2. Abrir la URL en Safari o Chrome e instalarla en la pantalla de inicio.
3. Importar `Escocia-datos-privados.json`.
4. Importar los tres ZIP de audio.
5. Abrir **Offline** y comprobar que aparecen 29/29 audios.
6. Probar una pista en modo avión.

Los mapas no forman parte de la PWA. Hay que descargar antes las regiones necesarias en Google Maps o Apple Maps. Con mapas offline, los enlaces de la app abren la aplicación cartográfica instalada.

## Privacidad

No subir `Escocia-datos-privados.json`, los ZIP, MP3, billetes ni reservas al repositorio público. El archivo `.gitignore` impide añadir accidentalmente los formatos privados habituales.

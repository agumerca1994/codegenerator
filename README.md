# Invoice Parser Generator

Herramienta para extraer texto de facturas PDF y generar código JavaScript de parser para n8n usando OpenAI.

Modelo principal de generación: `gpt-5.3-codex` (fallback automático a `gpt-4o`).

## Requisitos

- Docker Desktop con integración WSL2 habilitada
- Ubuntu en WSL2
- Git
- API key de OpenAI

## Variables de entorno

1. Copia el archivo de ejemplo:

```bash
cp .env.local.example .env.local
```

2. Edita `.env.local`:

```env
OPENAI_API_KEY=tu_api_key_real
```

## Ejecutar en local con Docker (WSL)

Desde el directorio del proyecto:

```bash
docker compose --env-file .env.local up --build
```

Si tu red/proxy bloquea `registry.npmjs.org` (errores 400/403/5xx en `npm install`), define en `.env.local`:

```env
NPM_REGISTRY=https://registry.npmmirror.com/
```

Y reconstruye:

```bash
docker compose --env-file .env.local build --no-cache
docker compose --env-file .env.local up
```

Abrir en navegador:

- `http://localhost:3000`

Para detener:

```bash
docker compose down
```

## Endpoints API

- `POST /api/extract-pdf` (multipart/form-data con campo `file` PDF)
- `POST /api/generate-code` (`{ "text": "..." }`)

## Validaciones funcionales rápidas

1. UI:
- `GET /` debe cargar correctamente.

2. Generación:
- Pega texto de factura de más de 50 caracteres.
- Click en `Generar Código`.
- Debe retornar `provider`, `confidence`, `fields`, `code` en UI.

3. Extracción PDF:
- Sube un PDF válido (<10MB).
- Debe mostrar preview y luego permitir generar código.

4. Errores esperados:
- PDF no válido o >10MB.
- Texto menor a 50 caracteres.
- Falta de `OPENAI_API_KEY`.

## Benchmark de fixtures

Con la app detenida o encendida (no depende de la API), puedes correr benchmark de parsers existentes + PDFs de `context/`:

```bash
npm run benchmark:fixtures
```

Este benchmark ejecuta cada parser de `context/CodigosEjemplo` sobre:
- `context/Input/EntradaEjemplo.json`
- PDFs de `context/FacturasProveedores`

y reporta cobertura de campos requeridos del schema n8n.

Para benchmark end-to-end de la API (`/api/generate-code`) con esos fixtures:

```bash
npm run benchmark:api
```

Opcionalmente puedes cambiar URL:

```bash
BENCH_API_URL=http://localhost:3000 npm run benchmark:api
```

## Deploy en EasyPanel (Ubuntu)

### Opción elegida: Git + Dockerfile

1. Sube este proyecto a un repositorio Git.
2. En EasyPanel crea una app nueva tipo **Git-based Docker build**.
3. Configura:
- Build context: raíz del repo.
- Dockerfile path: `./Dockerfile`.
- Puerto interno: `3000`.
4. Agrega variable de entorno en EasyPanel:
- `OPENAI_API_KEY` con tu valor real.
5. Ejecuta el deploy inicial.
6. Asigna dominio/subdominio y habilita SSL automático (Let's Encrypt).

## Notas

- No subas `.env.local` al repositorio.
- La API key nunca se expone al cliente: solo se usa en rutas `/api` server-side.

# El Forcón · Gestión de Partidos de Pádel

Aplicación web para gestionar las inscripciones diarias de los partidos de pádel del centro **El Forcón** (lunes a viernes, dos partidos a las 19:00), con prioridad estricta del Partido 1, reorganización automática de la cola cronológica, sincronización en tiempo real entre usuarios y panel de administración.

---

## 1. Requisitos previos

- Cuenta gratuita en [Supabase](https://supabase.com/)
- Cuenta gratuita en [GitHub](https://github.com/)
- Cuenta gratuita en [Cloudflare Pages](https://pages.cloudflare.com/)
- [Node.js 18 o superior](https://nodejs.org/) instalado en tu ordenador

---

## 2. Crear y configurar el proyecto en Supabase

1. Accede a [Supabase](https://supabase.com/) y pulsa **New Project**.
2. Elige un nombre (por ejemplo `padel-el-forcon`), contraseña segura de base de datos y región europea (por ejemplo **Frankfurt** o **Ireland**).
3. Espera 1-2 minutos a que el proyecto esté listo.
4. En el menú lateral izquierdo entra en **SQL Editor** → **New query**.
5. Copia y pega todo el contenido de `supabase/schema.sql` y pulsa **Run**.
   - Esto crea todas las tablas (`profiles`, `user_roles`, `matches`, `registrations`, `audit_logs`), la vista `daily_queue_view`, políticas RLS, funciones atómicas RPC y activa Supabase Realtime.
6. Ve a **Authentication → Providers → Email** y verifica que:
   - **Enable Email provider** está activado.
   - **Confirm email** está activado (verificación por correo).
7. Ve a **Authentication → URL Configuration**:
   - En **Site URL**, escribe la URL de tu aplicación (por ejemplo `https://tu-proyecto.pages.dev` cuando la despliegues, o `http://localhost:5173` para pruebas locales).
   - En **Redirect URLs**, añade tanto `http://localhost:5173` como `https://*.pages.dev` o tu dominio final.
8. Ve a **Project Settings → API** y copia estos dos valores (solo públicos):
   - **Project URL** (`VITE_SUPABASE_URL`)
   - **anon public** key (`VITE_SUPABASE_ANON_KEY`)

> **IMPORTANTE DE SEGURIDAD:** Nunca copies ni utilices la clave `service_role` en el frontend ni en Cloudflare Pages.

---

## 3. Instalación y ejecución en local

1. Clona o descarga este repositorio y entra en la carpeta:
   ```bash
   cd padel-el-forcon
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Crea el archivo `.env` a partir de `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Edita `.env` e introduce tus claves de Supabase:
   ```env
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU_SUPABASE_ANON_PUBLIC_KEY
   ```
5. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
6. Abre en tu navegador `http://localhost:5173`.

---

## 4. Configurar el primer administrador

Por seguridad, el rol de administrador **no puede asignarse desde la interfaz web**.

1. Regístrate normalmente en la aplicación web con el correo de la persona administradora y verifica su correo electrónico.
2. Entra en **Supabase → SQL Editor → New query**.
3. Ejecuta esta consulta sustituyendo el correo por el del administrador:

```sql
UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'admin@elforcon.es'
);
```

4. Recarga la página web: aparecerá automáticamente la pestaña **Administración**.

---

## 5. Despliegue en Cloudflare Pages desde GitHub

1. Sube todo el proyecto a un repositorio nuevo en tu cuenta de **GitHub** (el archivo `.gitignore` ya excluye `.env` y `node_modules`).
2. Entra en el panel de **Cloudflare → Workers & Pages → Create → Pages → Connect to Git**.
3. Selecciona tu repositorio de GitHub.
4. Configura la compilación con estos valores:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. Despliega la sección **Environment variables (Production y Preview)** y añade:
   - `VITE_SUPABASE_URL` = tu URL de Supabase
   - `VITE_SUPABASE_ANON_KEY` = tu clave `anon public` de Supabase
6. Pulsa **Save and Deploy**.
7. Cuando termine, copia la URL `https://....pages.dev` generada y añádela en **Supabase → Authentication → URL Configuration → Site URL**.

---

## 6. Pruebas de verificación obligatorias

### A. Pruebas automatizadas de backend (SQL)
1. Abre **Supabase → SQL Editor**.
2. Pega el contenido de `supabase/tests.sql` y pulsa **Run**.
3. Verifica en los mensajes de salida:
   `TODAS LAS PRUEBAS SQL PASARON CORRECTAMENTE (Escenarios A, B, C, D y E).`
   *(El script ejecuta `ROLLBACK` al final, por lo que no deja datos ficticios).*

### B. Checklist manual en navegador (Escenarios F, G, H e I)
- **Escenario F (Concurrencia)**: Con 7 jugadores inscritos en un día, pulsa `APUNTARME` al mismo tiempo desde dos cuentas distintas. Solo una obtendrá la 8ª plaza; la otra recibirá *"No quedan plazas disponibles."* gracias a `pg_advisory_xact_lock`.
- **Escenario G (Cancelación del usuario)**: Pulsa `DARME DE BAJA`, verifica el texto de confirmación diferenciado para Partido 1 o Partido 2, confirma con `SÍ, DESAPUNTARME` y comprueba la reorganización inmediata.
- **Escenario H (Tiempo real)**: Abre la aplicación en dos dispositivos (móvil y ordenador). Apunta o desapunta a un jugador en uno y verifica que el otro se actualiza automáticamente sin recargar.
- **Escenario I (Autenticación)**: Prueba registro, verificación de correo, inicio de sesión, recarga de página (sesión persistente), recuperación de contraseña y cierre de sesión.

---

### Verificación de requisitos clave

- **Prioridad del Partido 1 y cola cronológica en PostgreSQL**: `register_for_match` y `cancel_registration` usan `pg_advisory_xact_lock` por día (`match_date`) para serializar peticiones simultáneas. La tabla `registrations` almacena únicamente la cola cronológica `(registered_at, queue_seq)` y tanto la vista `daily_queue_view` como el frontend asignan puestos `1–4` al Partido 1 y `5–8` al Partido 2. Si alguien del Partido 1 se da de baja, el 5º puesto pasa automáticamente al 4º (Partido 1), y si quedan menos de 4 inscritos el Partido 2 se cierra automáticamente.
- **Privacidad y seguridad**: `profiles` no almacena correos electrónicos; las mutaciones directas sobre `registrations`, `matches` y `user_roles` están bloqueadas por RLS y solo se ejecutan mediante funciones `SECURITY DEFINER` validadas con `auth.uid()` e `is_admin()`. La clave `service_role` no se utiliza ni expone en ningún punto.
- **Confirmación diferenciada de baja**: `CancelConfirmModal.tsx` implementa exactamente los mensajes diferenciados para Partido 1 y Partido 2, destacando `NO, MANTENER MI PLAZA` frente a `SÍ, DESAPUNTARME`, mientras que `APUNTARME` actúa de forma directa con indicador de carga.


```
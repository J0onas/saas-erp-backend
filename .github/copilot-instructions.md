# Copilot Instructions — POSmart (SaaS Facturación Electrónica)

## Contexto Global del Sistema posMart

Eres un Senior Full-Stack Engineer trabajando en posMart, un SaaS POS multi-tenant.

### Backend (saas-backend)
- Framework: NestJS 11 + TypeScript.
- Base de Datos: PostgreSQL 16 (Supabase). No usamos ORM Entities, solo TypeORM Raw Queries (`queryRunner.query`).
- Regla de Oro Multi-tenant: TODA consulta debe iniciar con la transacción: `SELECT set_config('app.current_tenant', $1, true)`.
- Aislamiento: El `tenant_id` se extrae del JWT vía `@AuthGuard('jwt')`.

### Frontend (saas-frontend)
- Framework: Next.js 16 (App Router) + React 19.
- Estilos: Tailwind CSS v4.
- UI/UX: Diseño limpio, responsivo, B2B, modo oscuro por defecto (`bg-slate-900`), estilo "Bento Box" para dashboards.
- Componentes: Usar íconos de `lucide-react`.

### Reglas de Ejecución
- Analiza los archivos existentes usando `@` antes de crear nuevos.
- Escribe código limpio, maneja errores en bloques try/catch y haz rollback de transacciones si fallan.

---

This is a **monorepo** with two projects:
- `saas-backend/` — NestJS API (TypeScript, PostgreSQL, TypeORM)
- `saas-frontend/` — Next.js 16 App Router (React 19, Tailwind CSS 4)

---

## Build & Run Commands

### Backend (`saas-backend/`)

```bash
npm install
npm run start:dev          # Development (watch mode)
npm run build && npm run start:prod  # Production

npm run lint               # ESLint with auto-fix
npm run format             # Prettier
```

### Frontend (`saas-frontend/`)

```bash
npm install
npm run dev                # Development (localhost:3000)
npm run build && npm run start  # Production build

npm run lint               # ESLint
```

## Testing (Backend)

```bash
npm run test                              # All unit tests
npx jest src/auth/auth.service.spec.ts    # Single file
npx jest --testNamePattern="should login" # Pattern match
npm run test:watch                        # Watch mode
npm run test:e2e                          # E2E tests
npm run test:cov                          # Coverage report
```

---

## Architecture

### Multi-tenant SaaS with Row-Level Security

**POSmart** is a multi-tenant B2B invoicing SaaS for the Peruvian market (SUNAT electronic billing). Each tenant is an independent business with isolated data.

- **Tenant isolation**: Every table has `tenant_id`. Services receive `tenantId` from JWT (`req.user.tenantId`)
- **PostgreSQL RLS**: Queries set `app.current_tenant` config for Row-Level Security policies
- **Subscription control**: `SubscriptionGuard` checks `subscription_status` before billing operations (returns 402 if expired)

### User Roles

| Role | Access |
|------|--------|
| `SUPERADMIN` | Full platform access, cross-tenant management |
| `GERENTE` | Tenant owner: users, reports, credit notes, settings |
| `CAJERO` | POS operations: invoicing, cash register |

Frontend navigation filters by role (see `NAV_ITEMS` in `Navbar.tsx`).

### Backend Module Structure

```
src/{feature}/
├── {feature}.module.ts      # Module declaration
├── {feature}.controller.ts  # REST endpoints
├── {feature}.service.ts     # Business logic (raw SQL via DataSource)
├── dto/                     # Request validation (class-validator)
└── entities/                # TypeORM entities
```

Key modules: `auth`, `invoice`, `admin`, `plans`, `branches`, `notifications`, `cash`, `products`, `users`, `reports`

### Frontend Structure (Next.js App Router)

```
app/
├── components/              # Shared components (Navbar, PageWrapper, BranchSelector)
├── dashboard/page.tsx       # Main POS screen (invoicing + cart)
├── productos/               # Inventory management
├── historial/               # Invoice history
├── reportes/                # Analytics (GERENTE+)
├── usuarios/                # User management (GERENTE+)
├── sucursales/              # Multi-branch management (GERENTE+)
├── superadmin/              # Platform admin (SUPERADMIN only)
├── login/, register/, etc.  # Auth flows
└── layout.tsx               # Root layout
```

### Database Patterns (Backend)

- **Raw SQL preferred**: Services use `DataSource.query()` with parameterized queries
- **QueryRunner for transactions**: `createQueryRunner()` → `startTransaction()` → `commitTransaction()`
- **RLS context**: `set_config('app.current_tenant', $1, true)` inside transactions

### Guard Stacking (Backend)

```typescript
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
@Roles('GERENTE', 'SUPERADMIN')
```

Order: `AuthGuard` → `SubscriptionGuard` (402 if expired) → `RolesGuard` → `PlanGuard`

### API Communication

- **Base URL**: `NEXT_PUBLIC_API_URL` env var (frontend)
- **API prefix**: All backend routes under `/api/v1`
- **Auth**: JWT in `Authorization: Bearer <token>` header, stored in `localStorage.saas_token`
- **User data**: Stored in `localStorage.user_data` as JSON

### Real-time Notifications

Backend sends SSE events via `/api/v1/notifications/stream`. Frontend consumes with `useNotifications()` hook. Types: `LOW_STOCK`, `NEW_INVOICE`, `SUBSCRIPTION_EXPIRING`, `CASH_CLOSED`, `SYSTEM`.

---

## Key Conventions

### Naming
- **Backend**: Entity files `{name}.entity.ts`, DTOs `create-{name}.dto.ts`
- **Database**: `snake_case` columns (mapped to `camelCase` in TypeScript)
- **Frontend**: Page components in `app/{route}/page.tsx`, shared components in `app/components/`

### Response Format (Backend)
```typescript
{ success: true, data: [...] }
{ success: true, message: 'Operación exitosa.' }
{ success: false, error: 'CODE', message: 'Description' }
```

### Error Handling
- **Backend**: NestJS exceptions (`BadRequestException`, `ForbiddenException`, etc.). Subscription: `HttpStatus.PAYMENT_REQUIRED` (402)
- **Frontend**: Check `res.status === 402` for subscription expiry, show renewal modal

### Styling (Frontend)
- Tailwind CSS 4 with dark theme (`bg-[#0f172a]`, `text-slate-*`)
- Responsive: Mobile-first with `md:` breakpoints
- Component pattern: `'use client'` directive for interactive pages

### Logging (Backend)
```typescript
private readonly logger = new Logger(MyService.name);
this.logger.log('Processing...');
```

---

## External Integrations

- **SUNAT / Nubefact**: Electronic invoicing (Peru tax authority), XML-UBL generation
- **MercadoPago**: Subscription payment processing
- **Nodemailer**: Transactional emails
- **PDFKit**: Invoice PDF generation
- **Recharts**: Dashboard analytics charts (frontend)

## Environment Variables

### Backend
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing key
- `MERCADO_PAGO_ACCESS_TOKEN` — Payment integration
- `PORT` — Server port (defaults to 3000)

### Frontend
- `NEXT_PUBLIC_API_URL` — Backend API base URL (e.g., `http://localhost:3001`)

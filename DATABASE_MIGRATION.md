# Migración a Base de Datos Vercel Postgres (Neon)

## ✅ Cambios Completados

### 1. Archivos Creados

- **`src/lib/db.ts`**: Cliente de base de datos Neon
- **`src/types/database.ts`**: Tipos TypeScript para el esquema de BD
- **`DATABASE_MIGRATION.md`**: Esta documentación

### 2. Archivos Refactorizados

- **`src/pages/index.astro`**: 
  - ❌ Ya NO usa `src/data/items.ts`
  - ✅ Ahora lee de la tabla `items` con JOIN a `item_images`
  - ✅ Filtra solo items con `status = 'active'`
  - ✅ Ordena por `sort_order`

- **`src/pages/api/paypal/capture-order.ts`**:
  - ✅ Importa el cliente de BD
  - ✅ Actualiza `raised_amount` cuando un pago es exitoso
  - ✅ Actualiza `updated_at` automáticamente
  - ✅ Manejo de errores de BD separado del pago

- **`src/components/WishlistItem.astro`**:
  - ✅ Usa el nuevo tipo `WishlistItem` de `types/database.ts`
  - ✅ Muestra la imagen desde `item.imageUrl` (de la BD)
  - ✅ Fallback a imagen placeholder si no hay imagen en BD

- **`.env.example`**:
  - ✅ Añadida variable `DATABASE_URL`

- **`src/env.d.ts`**:
  - ✅ Tipos TypeScript para `DATABASE_URL` y otras variables

### 3. Esquema de Base de Datos

El código está preparado para este esquema:

```sql
-- Tabla principal de items
CREATE TYPE item_status AS ENUM ('draft', 'active', 'funded');

CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    goal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    raised_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status item_status NOT NULL DEFAULT 'draft',
    sort_order SMALLINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de imágenes (relación 1:N)
CREATE TABLE item_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    image_url VARCHAR(1024) NOT NULL,
    alt_text VARCHAR(255),
    sort_order SMALLINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_item_images_on_item_id ON item_images(item_id);
```

## 🔧 Pasos Pendientes

### 1. Instalar Dependencia

```bash
pnpm install @neondatabase/serverless
```

### 2. Configurar Variables de Entorno

Añade a tu archivo `.env`:

```env
POSTGRES_URL=postgresql://user:password@host/database?sslmode=require
```

**Dónde obtener `POSTGRES_URL`:**
1. Ve a tu proyecto en Vercel Dashboard
2. Settings → Storage → Postgres
3. Copia la variable `POSTGRES_URL`

### 3. Poblar la Base de Datos (Opcional)

Si quieres migrar los datos de prueba de `src/data/items.ts` a la BD:

```sql
-- Insertar items de ejemplo
INSERT INTO items (name, description, goal_amount, raised_amount, status, sort_order)
VALUES 
  ('Nuevo Cáliz', 'Un vaso sagrado para la Eucaristía.', 300.00, 150.00, 'active', 1),
  ('Restauración de Vitrales', 'Restauración de los vitrales históricos del oratorio.', 2500.00, 1000.00, 'active', 2),
  ('Sistema de Sonido', 'Actualización del sistema de audio para mejorar la acústica.', 1800.00, 720.00, 'active', 3),
  ('Mantel de Altar', 'Nuevo mantel bordado para el altar principal.', 450.00, 225.00, 'active', 4),
  ('Iluminación LED', 'Sistema de iluminación eficiente y respetuoso.', 3200.00, 800.00, 'active', 5),
  ('Restauración de Bancos', 'Reparación y barnizado de los bancos de madera.', 2000.00, 400.00, 'active', 6);

-- Insertar imágenes (ejemplo con Unsplash)
INSERT INTO item_images (item_id, image_url, alt_text, sort_order)
SELECT 
  id,
  'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?w=400&h=300&fit=crop',
  name,
  0
FROM items;
```

### 4. Probar Localmente

```bash
pnpm dev
```

Verifica:
- ✅ La página carga los items de la BD
- ✅ Las imágenes se muestran correctamente
- ✅ Al hacer una donación de prueba, `raised_amount` se actualiza en la BD

### 5. Deploy a Vercel

```bash
vercel --prod
```

O haz push a tu repositorio si tienes auto-deploy configurado.

## 📝 Notas Importantes

### Flujo de Donación

1. Usuario introduce cantidad y hace clic en PayPal
2. PayPal crea orden con `custom_id = item.id` (UUID)
3. Usuario aprueba el pago en PayPal
4. Frontend llama a `/api/paypal/capture-order` con `orderID`
5. Backend:
   - Captura el pago con PayPal API
   - Verifica que `status === 'COMPLETED'`
   - Extrae `amount` y `custom_id` (item UUID)
   - **Actualiza la BD**: `raised_amount += amount`
6. Frontend muestra mensaje de éxito

### Manejo de Errores

- Si el pago es exitoso pero falla la actualización de BD, el endpoint devuelve error 500 con detalles
- Deberías implementar un sistema de retry o notificación manual para estos casos
- Los logs en consola usan emojis para fácil identificación: ✅ éxito, ❌ error

### Imágenes

- La consulta actual obtiene solo la imagen con `sort_order = 0` (imagen principal)
- Si un item no tiene imagen, se usa un placeholder de Unsplash
- Para múltiples imágenes por item, necesitarás ajustar la consulta y el componente

### Archivo `src/data/items.ts`

- ❌ **Ya NO se usa** en producción
- Puedes eliminarlo o mantenerlo como referencia
- El componente ahora usa `src/types/database.ts`

## 🚀 Próximas Mejoras

1. **Cache**: Implementar cache de items para reducir consultas a BD
2. **Imágenes múltiples**: Galería de imágenes por item
3. **Admin panel**: CRUD de items desde la UI
4. **Webhooks**: Usar PayPal webhooks en lugar de polling
5. **Transacciones**: Tabla de `donations` para auditoría completa
6. **Estados**: Actualizar `status` a 'funded' cuando `raised_amount >= goal_amount`

## 🐛 Troubleshooting

### Error: "Cannot find module '@neondatabase/serverless'"
```bash
pnpm install @neondatabase/serverless
```

### Error: "POSTGRES_URL is not defined"
Añade `POSTGRES_URL` a tu `.env` local y a las variables de entorno de Vercel.

### Items no aparecen
Verifica que:
1. La BD tiene items con `status = 'active'`
2. `POSTGRES_URL` es correcta
3. La conexión a la BD funciona (prueba con un cliente SQL)

### Donación exitosa pero BD no actualiza
1. Revisa los logs del servidor (consola o Vercel logs)
2. Verifica que el `custom_id` en PayPal coincide con un UUID válido en la tabla `items`
3. Comprueba permisos de escritura en la BD

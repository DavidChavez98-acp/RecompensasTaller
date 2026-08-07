/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Solicitud Credito
 */

type RateLimitEntry = {
  timestamps: number[];
};

const globalStore = globalThis as typeof globalThis & {
  rateLimitStore?: Map<string, RateLimitEntry>;
};

if (!globalStore.rateLimitStore) {
  globalStore.rateLimitStore = new Map();
}

const store = globalStore.rateLimitStore;

export type RateLimitConfig = {
  limit: number; // Límite máximo de peticiones
  windowMs: number; // Ventana de tiempo en ms
};

// Valida el límite de peticiones de una clave (IP y ruta)
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): {
  limited: boolean;
  remaining: number;
  resetSeconds: number;
} {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return {
      limited: false,
      remaining: config.limit,
      resetSeconds: 0,
    };
  }

  const now = Date.now();
  const entry = store.get(key) || { timestamps: [] };

  // Eliminar marcas de tiempo fuera de la ventana
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < config.windowMs);

  if (entry.timestamps.length >= config.limit) {
    const oldest = entry.timestamps[0] || now;
    const resetTime = oldest + config.windowMs;
    const resetSeconds = Math.max(0, Math.ceil((resetTime - now) / 1000));
    
    return {
      limited: true,
      remaining: 0,
      resetSeconds,
    };
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  const resetTime = (entry.timestamps[0] || now) + config.windowMs;
  const resetSeconds = Math.max(0, Math.ceil((resetTime - now) / 1000));

  return {
    limited: false,
    remaining: config.limit - entry.timestamps.length,
    resetSeconds,
  };
}

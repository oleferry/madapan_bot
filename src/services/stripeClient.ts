import axios from 'axios';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Cobro con Stripe por enlace, sin Telegram Payments.
//
// Se usa esto porque Stripe no aparece como proveedor en el BotFather de esta
// cuenta. El camino nativo (provider_token) seguiría siendo mejor —el cliente
// no sale del chat— pero este funciona con cualquier cuenta de Stripe y sin
// depender de la lista de proveedores de Telegram.
//
// Tampoco hace falta webhook, que es lo que obligaría a montar un servidor
// HTTP público: el bot le pregunta a Stripe si esa reserva está pagada cuando
// hace falta saberlo.
//
// Se llama a la API REST con axios en vez de traer el SDK de Stripe: son dos
// endpoints y el SDK son varios megas de dependencia.

const API = 'https://api.stripe.com/v1';

export function estaConfigurado(): boolean {
  return Boolean(config.stripeSecretKey);
}

export function esModoPrueba(): boolean {
  return config.stripeSecretKey.startsWith('sk_test_');
}

function cabeceras(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export interface EnlacePago {
  id: string;
  url: string;
}

// Crea un enlace de pago por un importe concreto.
export async function crearEnlace(
  referencia: string, importe: number, descripcion: string
): Promise<EnlacePago> {
  if (!estaConfigurado()) throw new Error('Falta STRIPE_SECRET_KEY');

  const volver = config.botUrl || 'https://www.madapan.es';
  const cuerpo = new URLSearchParams({
    mode: 'payment',
    success_url: volver,
    cancel_url: volver,
    client_reference_id: referencia,
    'metadata[referencia]': referencia,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][product_data][name]': descripcion.slice(0, 250),
    // Stripe trabaja en céntimos y no admite decimales.
    'line_items[0][price_data][unit_amount]': String(Math.round(importe * 100)),
  });

  const r = await axios.post<{ id: string; url: string }>(
    `${API}/checkout/sessions`, cuerpo.toString(), { headers: cabeceras(), timeout: 15000 }
  );
  log('Stripe', `Enlace creado para ${referencia}: ${importe.toFixed(2)} €`);
  return { id: r.data.id, url: r.data.url };
}

export interface EstadoPago {
  pagado: boolean;
  estado: string;            // "paid", "unpaid", "no_payment_required"
  importe: number;
}

export async function consultar(sessionId: string): Promise<EstadoPago | null> {
  if (!estaConfigurado()) return null;
  try {
    const r = await axios.get<{ payment_status: string; amount_total: number }>(
      `${API}/checkout/sessions/${sessionId}`, { headers: cabeceras(), timeout: 15000 }
    );
    return {
      pagado: r.data.payment_status === 'paid',
      estado: r.data.payment_status,
      importe: (r.data.amount_total ?? 0) / 100,
    };
  } catch (err) {
    warn('Stripe', `No se pudo consultar ${sessionId}: ${(err as Error).message}`);
    return null;
  }
}
